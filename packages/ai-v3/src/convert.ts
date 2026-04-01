import type { LanguageModelV3Message } from "@ai-sdk/provider";
import type { AIGuardMessage } from "@nulab/datadog-ai-guard-middleware-core";
import {
  convertAssistantContentToAIGuardMessages,
  convertPromptContent,
  extractToolResultContent,
} from "@nulab/datadog-ai-guard-middleware-core";

export type {
  AIGuardMessage,
  ToolCallPartInput,
} from "@nulab/datadog-ai-guard-middleware-core";
export {
  convertAssistantContentToAIGuardMessages,
  convertToolCallPart,
} from "@nulab/datadog-ai-guard-middleware-core";

function convertMessage(message: LanguageModelV3Message): AIGuardMessage | AIGuardMessage[] {
  switch (message.role) {
    case "system":
      return {
        role: message.role,
        content: convertPromptContent(message.content),
      };

    case "user":
      return {
        role: message.role,
        content: convertPromptContent(message.content),
      };

    case "assistant":
      return convertAssistantContentToAIGuardMessages(message.content);

    case "tool": {
      if (!Array.isArray(message.content)) {
        return { role: message.role, content: "" };
      }

      const toolMessages: AIGuardMessage[] = [];
      for (const part of message.content) {
        if (part.type === "tool-result") {
          if (typeof part.toolCallId !== "string" || part.toolCallId.trim() === "") {
            throw new TypeError("Tool result must have a non-empty tool_call_id");
          }
          toolMessages.push({
            role: "tool",
            tool_call_id: part.toolCallId,
            content: extractToolResultContent(part),
          });
        }
      }
      return toolMessages;
    }

    default: {
      // Defensive fallback for unexpected roles at runtime
      const msg = message as unknown as { role: string; content: unknown };
      return { role: msg.role, content: convertPromptContent(msg.content) };
    }
  }
}

export function convertToAIGuardFormat(prompt: LanguageModelV3Message[]): AIGuardMessage[] {
  const result: AIGuardMessage[] = [];

  for (const message of prompt) {
    const converted = convertMessage(message);
    if (Array.isArray(converted)) {
      result.push(...converted);
    } else {
      result.push(converted);
    }
  }

  return result;
}
