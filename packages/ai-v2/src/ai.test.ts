import type { LanguageModelV2CallOptions } from "@ai-sdk/provider";
import { defineAIGuardMiddlewareTests } from "@nulab/datadog-ai-guard-middleware-internal/testing";
import { AIGuardMiddleware, AIGuardMiddlewareAbortError } from "./ai.js";

defineAIGuardMiddlewareTests({
  AIGuardMiddleware,
  AIGuardMiddlewareAbortError,
  castCallOptions: (opts) => opts as LanguageModelV2CallOptions,
});
