import type tracer from "dd-trace";
import type {
  AIGuardContentPart,
  AIGuardImageUrlContentPart,
  AIGuardMessage,
  CoreContentPart,
  ToolCallPartInput,
} from "./types.js";

function hasMeaningfulContent(content: string | AIGuardContentPart[]): boolean {
  return typeof content === "string" ? content !== "" : content.length > 0;
}

function createAssistantTextMessage(
  content: string | AIGuardContentPart[],
): AIGuardMessage | undefined {
  if (!hasMeaningfulContent(content)) {
    return undefined;
  }

  return {
    role: "assistant",
    content,
  };
}

function isUrlLikeString(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function isImageMediaType(mediaType: unknown): mediaType is string {
  return typeof mediaType === "string" && mediaType.toLowerCase().startsWith("image/");
}

function toImageUrlValue(data: unknown, mediaType: string): string | undefined {
  if (data instanceof URL) {
    return data.toString();
  }

  if (typeof data === "string") {
    if (data.trim() === "") {
      return undefined;
    }
    if (isUrlLikeString(data)) {
      return data;
    }
    return `data:${mediaType};base64,${data}`;
  }

  if (data instanceof Uint8Array) {
    const base64 = Buffer.from(data).toString("base64");
    return `data:${mediaType};base64,${base64}`;
  }

  return undefined;
}

function convertImageFilePart(part: CoreContentPart): AIGuardImageUrlContentPart | undefined {
  if (part.type !== "file" || !isImageMediaType(part.mediaType)) {
    return undefined;
  }

  const url = toImageUrlValue(part.data, part.mediaType);
  if (!url) {
    return undefined;
  }

  return {
    type: "image_url",
    image_url: {
      url,
    },
  };
}

export function convertPromptContent(content: unknown): string | AIGuardContentPart[] {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const result: AIGuardContentPart[] = [];
  let hasImage = false;
  for (const part of content as CoreContentPart[]) {
    if (part.type === "text" && part.text) {
      result.push({
        type: "text",
        text: part.text,
      });
      continue;
    }

    const imagePart = convertImageFilePart(part);
    if (imagePart) {
      result.push(imagePart);
      hasImage = true;
    }
  }

  if (result.length === 0) {
    return "";
  }

  if (!hasImage) {
    return result.map((part) => (part.type === "text" ? part.text : "")).join("");
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Extract a string from a LanguageModel ToolResultOutput union.
 * Supports: { type: 'text'|'error-text', value: string }
 *           { type: 'json'|'error-json', value: JSONValue }
 *           { type: 'execution-denied', value?: string }
 *           { type: 'content', value: Array<{ type:'text', text:string } | ...> }
 */
function extractToolResultOutput(output: unknown): string {
  if (output === undefined) {
    return "";
  }
  if (typeof output === "string") {
    return output;
  }
  if (!isPlainObject(output) || !("type" in output)) {
    return safeJsonStringify(output);
  }
  const typed = output as { type: string; value?: unknown };
  switch (typed.type) {
    case "text":
    case "error-text":
      return typeof typed.value === "string" ? typed.value : "";
    case "json":
    case "error-json":
      return safeJsonStringify(typed.value);
    case "execution-denied":
      return typeof typed.value === "string" ? typed.value : "";
    case "content":
      if (Array.isArray(typed.value)) {
        return (typed.value as Array<{ type: string; text?: string }>)
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("");
      }
      return "";
    default:
      return safeJsonStringify(output);
  }
}

export function extractToolResultContent(part: { output?: unknown }): string {
  if (part.output !== undefined) {
    return extractToolResultOutput(part.output);
  }
  return "";
}

function safeJsonStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : "{}";
  } catch {
    return "{}";
  }
}

function normalizeArgumentsString(str: string): string {
  if (str.trim() === "") {
    return "{}";
  }

  try {
    JSON.parse(str);
    // Datadog accepts a string here, usually a JSON-serialized object.
    // Preserve any valid JSON value so arrays/primitives remain visible to AI Guard.
    return str;
  } catch {
    // Broken JSON is wrapped with _raw to preserve information
    return JSON.stringify({ _raw: str });
  }
}

function getRawToolArguments(toolCallPart: ToolCallPartInput): unknown {
  if (Object.hasOwn(toolCallPart, "input")) {
    return toolCallPart.input;
  }

  if (Object.hasOwn(toolCallPart, "args")) {
    return toolCallPart.args;
  }

  if (toolCallPart.function && Object.hasOwn(toolCallPart.function, "arguments")) {
    return toolCallPart.function.arguments;
  }

  if (Object.hasOwn(toolCallPart, "arguments")) {
    return toolCallPart.arguments;
  }

  return undefined;
}

function stringifyToolArguments(value: unknown): string {
  if (value === undefined) {
    return "{}";
  }

  if (typeof value === "string") {
    return normalizeArgumentsString(value);
  }

  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : "{}";
  } catch {
    return "{}";
  }
}

export function convertToolCallPart(toolCallPart: ToolCallPartInput): tracer.aiguard.ToolCall {
  const id = toolCallPart.toolCallId ?? toolCallPart.id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new TypeError("Tool call ID must be a non-empty string");
  }

  const name = toolCallPart.toolName ?? toolCallPart.function?.name ?? toolCallPart.name;
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("Tool call name must be a non-empty string");
  }

  return {
    id,
    function: {
      name,
      arguments: stringifyToolArguments(getRawToolArguments(toolCallPart)),
    },
  };
}

export function convertAssistantContentToAIGuardMessages(content: unknown): AIGuardMessage[] {
  if (!Array.isArray(content)) {
    return [{ role: "assistant", content: typeof content === "string" ? content : "" }];
  }

  // Group consecutive parts of the same kind (tool-call vs non-tool-call)
  // to preserve the original interleaving order.
  const groups: { isToolCall: boolean; parts: CoreContentPart[] }[] = [];
  for (const part of content as CoreContentPart[]) {
    const isToolCall = part.type === "tool-call";
    const last = groups[groups.length - 1];
    if (last && last.isToolCall === isToolCall) {
      last.parts.push(part);
    } else {
      groups.push({ isToolCall, parts: [part] });
    }
  }

  const messages: AIGuardMessage[] = [];
  for (const group of groups) {
    if (group.isToolCall) {
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: group.parts.map((p) => convertToolCallPart(p as ToolCallPartInput)),
      });
    } else {
      const textMessage = createAssistantTextMessage(convertPromptContent(group.parts));
      if (textMessage) {
        messages.push(textMessage);
      }
    }
  }

  if (messages.length > 0) {
    return messages;
  }

  return [{ role: "assistant", content: "" }];
}
