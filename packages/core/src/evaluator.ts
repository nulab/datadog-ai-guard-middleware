import type tracer from "dd-trace";
import { convertAssistantContentToAIGuardMessages, convertToolCallPart } from "./convert.js";
import { AIGuardAbortError, AIGuardClientError, AIGuardStreamTripWire } from "./errors.js";
import type {
  AIGuardEvaluator,
  AIGuardKind,
  AIGuardLogger,
  AIGuardMessage,
  ToolCallPartInput,
} from "./types.js";

export interface AIGuardEvaluationEngineOptions {
  evaluator: AIGuardEvaluator;
  allowOnFailure: boolean;
  logger: AIGuardLogger;
  buildAbortError: (kind: AIGuardKind) => Error;
}

export function normalizeAIGuardAction(
  action: unknown,
): tracer.aiguard.Evaluation["action"] | undefined {
  return action === "ALLOW" || action === "DENY" || action === "ABORT" ? action : undefined;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") {
    return error.message;
  }

  return String(error);
}

export function hasMeaningfulAssistantMessages(messages: AIGuardMessage[]): boolean {
  return messages.some((message) => {
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      return true;
    }

    if (typeof message.content === "string") {
      return message.content !== "";
    }

    return Array.isArray(message.content) && message.content.length > 0;
  });
}

export class AIGuardEvaluationEngine {
  #evaluator: AIGuardEvaluator;
  #allowOnFailure: boolean;
  #logger: AIGuardLogger;
  #buildAbortError: (kind: AIGuardKind) => Error;

  constructor(options: AIGuardEvaluationEngineOptions) {
    this.#evaluator = options.evaluator;
    this.#allowOnFailure = options.allowOnFailure;
    this.#logger = options.logger;
    this.#buildAbortError = options.buildAbortError;
  }

  get logger(): AIGuardLogger {
    return this.#logger;
  }

  #formatTag(kind: AIGuardKind, meta?: string): string {
    return meta ? `${kind} (${meta})` : kind;
  }

  #handleUnavailable(tag: string, detail: string): void {
    if (this.#allowOnFailure) {
      this.#logger.warn(
        "[AI Guard] %s — unavailable (%s); request will continue because allowOnFailure=%s",
        tag,
        detail,
        this.#allowOnFailure,
      );
      return;
    }

    this.#logger.error(
      "[AI Guard] %s — unavailable (%s); rejecting request because allowOnFailure=%s",
      tag,
      detail,
      this.#allowOnFailure,
    );
    throw new AIGuardClientError();
  }

  convertOrHandleUnavailable<T>(
    kind: AIGuardKind,
    meta: string | undefined,
    convert: () => T,
  ): T | undefined {
    try {
      return convert();
    } catch (error) {
      this.#handleUnavailable(
        this.#formatTag(kind, meta),
        `message conversion failed: ${getErrorMessage(error)}`,
      );
      return undefined;
    }
  }

  async evaluate(
    messages: AIGuardMessage[],
    kind: AIGuardKind,
    meta?: string,
  ): Promise<tracer.aiguard.Evaluation | undefined> {
    const tag = this.#formatTag(kind, meta);

    this.#logger.info(
      "[AI Guard] Evaluating %s — %d message(s) sent to AI Guard",
      tag,
      messages.length,
    );

    const start = performance.now();
    try {
      const result = await this.#evaluator.evaluate(messages, { block: true });
      const elapsed = (performance.now() - start).toFixed(1);

      const action = normalizeAIGuardAction(result?.action);

      if (action === "DENY" || action === "ABORT") {
        // Datadog AI Guard blocking policy is the source of truth. If the SDK returns
        // DENY/ABORT without throwing, the request is allowed to continue but we emit a
        // warning so misconfigured blocking policies are visible in logs.
        this.#logger.warn(
          "[AI Guard] %s — Datadog returned action=%s without blocking; request will continue. Check AI Guard blocking policy for this service/environment (%sms)",
          tag,
          action,
          elapsed,
        );
      } else {
        this.#logger.info("[AI Guard] %s — allowed (%sms)", tag, elapsed);
      }

      return result;
    } catch (error: unknown) {
      const elapsed = (performance.now() - start).toFixed(1);

      if (error instanceof Error && error.name === "AIGuardAbortError") {
        this.#logger.warn(
          "[AI Guard] %s — BLOCKED by security policy (%sms) error=%s",
          tag,
          elapsed,
          JSON.stringify({ name: error.name, message: error.message }),
        );
        throw this.#buildAbortError(kind);
      }

      this.#handleUnavailable(
        tag,
        `evaluation failed after ${elapsed}ms: ${getErrorMessage(error)}`,
      );
      return;
    }
  }

  async evaluateToolCall(
    toolCall: ToolCallPartInput,
    baseMessages: AIGuardMessage[] | undefined,
    precedingToolCalls: tracer.aiguard.ToolCall[] = [],
  ): Promise<tracer.aiguard.ToolCall | undefined> {
    if (!baseMessages) {
      return undefined;
    }

    const toolName = String(
      toolCall.toolName ?? toolCall.function?.name ?? toolCall.name ?? "unknown",
    );
    const toolCallId = String(toolCall.toolCallId ?? toolCall.id ?? "unknown");
    const meta = `${toolName} id=${toolCallId}`;
    const converted = this.convertOrHandleUnavailable("Tool call", meta, () =>
      convertToolCallPart(toolCall),
    );
    if (!converted) {
      return undefined;
    }

    const messages = [...baseMessages];
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [...precedingToolCalls, converted],
    });
    await this.evaluate(messages, "Tool call", meta);
    return converted;
  }

  async evaluateAssistantResponse(
    content: unknown,
    baseMessages: AIGuardMessage[] | undefined,
  ): Promise<void> {
    if (!baseMessages) {
      return;
    }

    const assistantMessages = this.convertOrHandleUnavailable("Assistant response", undefined, () =>
      convertAssistantContentToAIGuardMessages(content),
    );
    if (!assistantMessages) {
      return;
    }

    if (!hasMeaningfulAssistantMessages(assistantMessages)) {
      return;
    }

    const toolCallMessage = assistantMessages.find(
      (message) => Array.isArray(message.tool_calls) && message.tool_calls.length > 0,
    );
    const messages = [...baseMessages, ...assistantMessages];

    if (toolCallMessage?.tool_calls) {
      const toolNames = toolCallMessage.tool_calls.map((toolCall) => toolCall.function.name);
      await this.evaluate(
        messages,
        "Tool call",
        `tools=[${toolNames.join(",")}] count=${toolNames.length}`,
      );
      return;
    }

    await this.evaluate(messages, "Assistant response", `messages=${assistantMessages.length}`);
  }

  isBlockedByPolicy(error: unknown): boolean {
    if (error instanceof AIGuardAbortError) {
      return true;
    }
    if (error instanceof Error && "isRetryable" in error) {
      return (error as Record<string, unknown>).isRetryable === false;
    }
    return false;
  }

  createStreamErrorForAbort(error: unknown): AIGuardStreamTripWire {
    if (this.isBlockedByPolicy(error)) {
      return new AIGuardStreamTripWire("Tool call blocked by AI Guard security policy");
    }
    if (error instanceof AIGuardClientError) {
      return new AIGuardStreamTripWire("AI Guard evaluation failed");
    }
    return new AIGuardStreamTripWire("AI Guard security check failed");
  }
}
