import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4Message,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import type {
  AIGuardMessage,
  AIGuardMiddlewareOptions,
} from "@nulab/datadog-ai-guard-middleware-core";
import { AIGuardEvaluationEngine } from "@nulab/datadog-ai-guard-middleware-core";
import type tracer from "dd-trace";
import { convertToAIGuardFormat } from "./convert.js";
import { AIGuardMiddlewareAbortError, markAsNonRetryable } from "./marker.js";
import { normalizeContent } from "./normalize.js";

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

type DoGenerateResult = LanguageModelV4GenerateResult;
type DoStreamResult = LanguageModelV4StreamResult;

// NOTE: async/await is required by Vercel AI SDK middleware interface
/** AI Guard middleware for Vercel AI SDK (LanguageModelV4Middleware compatible). */
export class AIGuardMiddleware implements LanguageModelV4Middleware {
  readonly specificationVersion = "v4";

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

  async #evaluatePrompt(prompt: LanguageModelV4Message[]): Promise<AIGuardMessage[] | undefined> {
    if (!prompt.length) {
      return undefined;
    }

    const roles = prompt.map((m) => m.role);
    const meta = `roles=[${roles.join(",")}]`;
    const messages = this.#engine.convertOrHandleUnavailable("Prompt", meta, () =>
      convertToAIGuardFormat(prompt),
    );
    if (!messages) {
      return undefined;
    }

    if (!messages.length) {
      return undefined;
    }

    await this.#engine.evaluate(messages, "Prompt", meta);
    return messages;
  }

  async wrapGenerate({
    doGenerate,
    params,
  }: {
    doGenerate: () => PromiseLike<LanguageModelV4GenerateResult>;
    doStream: () => PromiseLike<LanguageModelV4StreamResult>;
    params: LanguageModelV4CallOptions;
    model: LanguageModelV4;
  }): Promise<DoGenerateResult> {
    const baseMessages = await this.#evaluatePrompt(params.prompt);

    const result = await doGenerate();

    if (result.content.length > 0 && baseMessages) {
      const content = this.#engine.convertOrHandleUnavailable("Assistant response", undefined, () =>
        normalizeContent(result.content),
      );
      if (content) await this.#engine.evaluateAssistantResponse(content, baseMessages);
    }

    return result;
  }

  async wrapStream({
    doStream,
    params,
  }: {
    doGenerate: () => PromiseLike<LanguageModelV4GenerateResult>;
    doStream: () => PromiseLike<LanguageModelV4StreamResult>;
    params: LanguageModelV4CallOptions;
    model: LanguageModelV4;
  }): Promise<DoStreamResult> {
    const baseMessages = await this.#evaluatePrompt(params.prompt);

    const result = await doStream();

    let stopped = false;
    const seenToolCalls: tracer.aiguard.ToolCall[] = [];

    const transform = new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
      transform: async (chunk, controller) => {
        if (stopped) {
          return;
        }

        if (chunk.type === "tool-call") {
          try {
            const converted = await this.#engine.evaluateToolCall(
              chunk,
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

    return {
      ...result,
      stream: wrappedStream,
    };
  }
}
