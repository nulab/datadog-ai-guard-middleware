import { defineIntegrationTests } from "@nulab/datadog-ai-guard-middleware-internal/testing";
import { type AIGuardEvaluator, AIGuardMiddleware } from "./ai.js";

defineIntegrationTests({
  AIGuardMiddleware,
  AIGuardEvaluator: undefined as unknown as AIGuardEvaluator,
});
