import type { LanguageModelV3Message } from "@ai-sdk/provider";
import { defineConvertTests } from "@nulab/datadog-ai-guard-middleware-internal/testing";
import { convertToAIGuardFormat } from "./convert.js";

defineConvertTests({
  convertToAIGuardFormat,
  castPrompt: (messages) => messages as unknown as LanguageModelV3Message[],
});
