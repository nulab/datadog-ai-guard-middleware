import type { AIGuardKind } from "@nulab/datadog-ai-guard-middleware-core";
import { AIGuardAbortError } from "@nulab/datadog-ai-guard-middleware-core";

// Vercel AI SDK marker symbols used by APICallError.isInstance() for duck-type checking.
// When both markers are present and isRetryable is false, the AI SDK's
// retryWithExponentialBackoff skips retries for non-transient security policy blocks.
const AI_SDK_ERROR_MARKER = Symbol.for("vercel.ai.error.AI_SDKError");
const API_CALL_ERROR_MARKER = Symbol.for("vercel.ai.error.AI_APICallError");

/**
 * Applies Vercel AI SDK non-retryable markers to an error.
 *
 * After calling this, the error will be recognized by the AI SDK's
 * `APICallError.isInstance()` duck-type check and skipped by
 * `retryWithExponentialBackoff` due to `isRetryable=false`.
 *
 * Any existing `isRetryable` property is overwritten to guarantee
 * the error will not be retried.
 */
export function markAsNonRetryable(error: Error): void {
  Object.defineProperty(error, AI_SDK_ERROR_MARKER, { value: true });
  Object.defineProperty(error, API_CALL_ERROR_MARKER, { value: true });
  Object.defineProperty(error, "isRetryable", { value: false, configurable: true });
}

/**
 * Non-retryable error thrown when AI Guard blocks a request by security policy.
 *
 * The Vercel AI SDK APICallError markers with isRetryable=false prevent
 * retryWithExponentialBackoff from retrying within the same model.
 *
 * For framework integration (e.g. Mastra), use the `createAbortError` option
 * in `AIGuardMiddlewareOptions` to supply a custom error class that your
 * framework recognizes. The middleware automatically calls `markAsNonRetryable`
 * on the custom error.
 */
export class AIGuardMiddlewareAbortError extends AIGuardAbortError {
  override readonly name = "AIGuardMiddlewareAbortError";
  readonly code = "AI_GUARD_MIDDLEWARE_ABORT";
  readonly isRetryable = false;

  constructor(kind: AIGuardKind) {
    super(kind);
    markAsNonRetryable(this);
  }
}
