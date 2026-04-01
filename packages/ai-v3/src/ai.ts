import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type tracer from "dd-trace";
import type {
  AIGuardMessage,
  AIGuardMiddlewareOptions,
  ToolCallPartInput,
} from "@nulab/datadog-ai-guard-middleware-core";
import { AIGuardEvaluationEngine } from "@nulab/datadog-ai-guard-middleware-core";
import { convertToAIGuardFormat } from "./convert.js";
import { AIGuardMiddlewareAbortError, markAsNonRetryable } from "./marker.js";

export type {
  AIGuardEvaluator,
  AIGuardKind,
  AIGuardLogger,
  AIGuardMiddlewareOptions,
} from "@nulab/datadog-ai-guard-middleware-core";
export {
  AIGuardClientError as AIGuardMiddlewareClientError,
  AIGuardStreamTripWire,
} from "@nulab/datadog-ai-guard-middleware-core";
export { AIGuardMiddlewareAbortError } from "./marker.js";

type DoGenerateResult = LanguageModelV3GenerateResult;
type DoStreamResult = LanguageModelV3StreamResult;

// NOTE: async/await is required by Vercel AI SDK middleware interface
/** AI Guard middleware for Vercel AI SDK (LanguageModelV3Middleware compatible). */
export class AIGuardMiddleware {
  #engine: AIGuardEvaluationEngine;

  constructor(options: AIGuardMiddlewareOptions) {
    const { evaluator, allowOnFailure = true, createAbortError, logger = console } = options || {};

    if (!evaluator) {
      throw new TypeError("AIGuardMiddleware: evaluator is required");
    }

    this.#engine = new AIGuardEvaluationEngine({
      evaluator,
      allowOnFailure,
      logger,
      buildAbortError: (kind) => {
        if (createAbortError) {
          const customError = createAbortError(kind, `${kind} blocked by AI Guard security policy`);
          markAsNonRetryable(customError);
          return customError;
        }
        return new AIGuardMiddlewareAbortError(kind);
      },
    });

    this.wrapGenerate = this.wrapGenerate.bind(this);
    this.wrapStream = this.wrapStream.bind(this);
  }

  async #evaluatePrompt(prompt: LanguageModelV3Message[]): Promise<AIGuardMessage[] | undefined> {
    const roles = prompt.map((m) => m.role);
    const meta = `roles=[${roles.join(",")}]`;
    const messages = this.#engine.convertOrHandleUnavailable("Prompt", meta, () =>
      convertToAIGuardFormat(prompt),
    );
    if (!messages) {
      return undefined;
    }

    await this.#engine.evaluate(messages, "Prompt", meta);
    return messages;
  }

  async wrapGenerate({
    doGenerate,
    params,
  }: {
    doGenerate: () => PromiseLike<LanguageModelV3GenerateResult>;
    doStream: () => PromiseLike<LanguageModelV3StreamResult>;
    params: LanguageModelV3CallOptions;
    model: LanguageModelV3;
  }): Promise<DoGenerateResult> {
    this.#engine.logger.info(
      "[AI Guard] wrapGenerate — start (prompt messages=%d)",
      params.prompt.length,
    );
    const baseMessages = await this.#evaluatePrompt(params.prompt);

    const result = await doGenerate();

    if (result.content.length > 0) {
      const toolCalls = result.content.filter((item) => item.type === "tool-call");
      if (toolCalls.length > 0) {
        this.#engine.logger.info(
          "[AI Guard] wrapGenerate — evaluating assistant turn with %d tool call(s)",
          toolCalls.length,
        );
      } else {
        this.#engine.logger.info("[AI Guard] wrapGenerate — evaluating assistant response");
      }
      await this.#engine.evaluateAssistantResponse(result.content, baseMessages);
    }

    this.#engine.logger.info("[AI Guard] wrapGenerate — done");
    return result;
  }

  async wrapStream({
    doStream,
    params,
  }: {
    doGenerate: () => PromiseLike<LanguageModelV3GenerateResult>;
    doStream: () => PromiseLike<LanguageModelV3StreamResult>;
    params: LanguageModelV3CallOptions;
    model: LanguageModelV3;
  }): Promise<DoStreamResult> {
    this.#engine.logger.info(
      "[AI Guard] wrapStream — start (prompt messages=%d)",
      params.prompt.length,
    );
    const baseMessages = await this.#evaluatePrompt(params.prompt);

    const result = await doStream();

    let stopped = false;
    const seenToolCalls: tracer.aiguard.ToolCall[] = [];

    const transform = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
      transform: async (chunk, controller) => {
        if (stopped) {
          return;
        }

        if (chunk.type === "tool-call") {
          try {
            const converted = await this.#engine.evaluateToolCall(
              chunk as ToolCallPartInput,
              baseMessages,
              seenToolCalls,
            );
            if (converted) {
              seenToolCalls.push(converted);
            }
          } catch (error) {
            stopped = true;
            if (this.#engine.isBlockedByPolicy(error)) {
              this.#engine.logger.warn(
                "[AI Guard] wrapStream — tool call blocked, terminating stream",
              );
            } else {
              this.#engine.logger.warn(
                "[AI Guard] wrapStream — tool call could not be evaluated, terminating stream",
              );
            }
            controller.enqueue({
              type: "error",
              error: this.#engine.createStreamErrorForAbort(error),
            });
            controller.terminate();
            return;
          }
        }

        if (chunk.type === "finish") {
          seenToolCalls.length = 0;
        }

        controller.enqueue(chunk);
      },
    });

    const wrappedStream = result.stream.pipeThrough(transform);
    this.#engine.logger.info("[AI Guard] wrapStream — stream transform attached");

    return {
      ...result,
      stream: wrappedStream,
    };
  }
}
