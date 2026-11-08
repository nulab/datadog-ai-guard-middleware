import type { LanguageModelV4CallOptions, LanguageModelV4FilePart } from "@ai-sdk/provider";
import { defineAIGuardMiddlewareTests } from "@nulab/datadog-ai-guard-middleware-internal/testing";
import { AIGuardMiddleware, AIGuardMiddlewareAbortError } from "./ai.js";

defineAIGuardMiddlewareTests({
  AIGuardMiddleware,
  AIGuardMiddlewareAbortError,
  castCallOptions: (opts) => opts as LanguageModelV4CallOptions,
  imageData: {
    type: "url",
    url: new URL("https://example.com/cat.png"),
  } satisfies LanguageModelV4FilePart["data"],
});
