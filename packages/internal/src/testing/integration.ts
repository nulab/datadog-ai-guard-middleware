import type { AIGuardEvaluator } from "@nulab/datadog-ai-guard-middleware-core";
import { beforeAll, describe, expect, it } from "vitest";

export interface IntegrationTestDeps {
  generate(
    evaluator: AIGuardEvaluator,
    toolCall: boolean,
  ): Promise<{
    text: string;
    toolNames: string[];
    stepCount: number;
  }>;
  stream(
    evaluator: AIGuardEvaluator,
    toolCall: boolean,
  ): Promise<{
    text: string;
    toolNames: string[];
  }>;
}

const hasCredentials = !!(
  process.env.DD_API_KEY &&
  process.env.DD_APP_KEY &&
  process.env.OPENAI_API_KEY
);

export function defineIntegrationTests(deps: IntegrationTestDeps): void {
  describe.skipIf(!hasCredentials)("AIGuardMiddleware integration (OpenAI)", () => {
    let evaluator: AIGuardEvaluator;

    beforeAll(async () => {
      const ddtracer = await import("dd-trace");
      ddtracer.default.init({ experimental: { aiguard: { enabled: true } } });
      // The core message type is wider than dd-trace's discriminated message union.
      evaluator = ddtracer.default.aiguard as AIGuardEvaluator;
    });

    it("generateText: safe prompt passes through AI Guard", async () => {
      expect((await deps.generate(evaluator, false)).text).toBeTruthy();
    });

    it("generateText: agent tool call is evaluated by AI Guard", async () => {
      const result = await deps.generate(evaluator, true);
      expect(result.toolNames).toContain("getCurrentTime");
      expect(result.stepCount).toBeGreaterThanOrEqual(2);
      expect(result.text).toBeTruthy();
    });

    it("streamText: safe prompt passes through AI Guard", async () => {
      expect((await deps.stream(evaluator, false)).text).toBeTruthy();
    });

    it("streamText: agent tool call is evaluated by AI Guard", async () => {
      const result = await deps.stream(evaluator, true);
      expect(result.toolNames).toContain("getCurrentTime");
      expect(result.text).toBeTruthy();
    });
  });
}
