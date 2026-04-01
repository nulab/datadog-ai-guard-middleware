import { defineMarkerTests } from "@nulab/datadog-ai-guard-middleware-internal/testing";
import { AIGuardMiddlewareAbortError, markAsNonRetryable } from "./marker.js";

defineMarkerTests({
  AIGuardMiddlewareAbortError,
  markAsNonRetryable,
});
