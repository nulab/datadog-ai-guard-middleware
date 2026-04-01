import { openai } from "@ai-sdk/openai";
import { generateText, jsonSchema, stepCountIs, streamText, tool, wrapLanguageModel } from "ai";
import { beforeAll, describe, expect, it } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface IntegrationTestDeps {
  AIGuardMiddleware: new (opts: any) => any;
  AIGuardEvaluator: any;
}

const hasCredentials = !!(
  process.env.DD_API_KEY &&
  process.env.DD_APP_KEY &&
  process.env.OPENAI_API_KEY
);

const SYSTEM_PROMPT = [
  "You are a helpful time assistant.",
  "When the user asks about the current time, you MUST call the getCurrentTime tool.",
  "After receiving the tool result, respond with the time in a natural sentence.",
].join(" ");

const timeTools = {
  getCurrentTime: tool({
    description: "Get the current time in a specific timezone",
    inputSchema: jsonSchema<{ timezone: string }>(
      {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "IANA timezone identifier, e.g. Asia/Tokyo",
          },
        },
        required: ["timezone"],
      },
      {
        validate: (value) => ({
          success: true,
          value: value as { timezone: string },
        }),
      },
    ),
    execute: async ({ timezone }) => {
      return {
        timezone,
        time: new Date().toLocaleString("en-US", { timeZone: timezone }),
      };
    },
  }),
};

export function defineIntegrationTests(deps: IntegrationTestDeps): void {
  const { AIGuardMiddleware } = deps;

  describe.skipIf(!hasCredentials)("AIGuardMiddleware integration (OpenAI)", () => {
    let evaluator: any;

    beforeAll(async () => {
      const ddtracer = await import("dd-trace");
      ddtracer.default.init({
        experimental: { aiguard: { enabled: true } },
      });
      evaluator = ddtracer.default.aiguard;
    });

    it("generateText: safe prompt passes through AI Guard", async () => {
      const middleware = new AIGuardMiddleware({ evaluator });
      const model = wrapLanguageModel({
        model: openai.chat("gpt-4o-mini"),
        middleware: [middleware],
      });

      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: "Say hello in one word.",
      });

      expect(result.text).toBeTruthy();
    });

    it("generateText: agent tool call is evaluated by AI Guard", async () => {
      const middleware = new AIGuardMiddleware({ evaluator });
      const model = wrapLanguageModel({
        model: openai.chat("gpt-4o-mini"),
        middleware: [middleware],
      });

      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: "What time is it in Tokyo?",
        tools: timeTools,
        stopWhen: stepCountIs(5),
      });

      const toolStep = result.steps.find((step) => step.toolCalls.length > 0);
      expect(toolStep).toBeTruthy();
      expect(toolStep!.toolCalls[0].toolName).toBe("getCurrentTime");

      expect(result.steps.length).toBeGreaterThanOrEqual(2);
      expect(result.text).toBeTruthy();
    });

    it("streamText: safe prompt passes through AI Guard", async () => {
      const middleware = new AIGuardMiddleware({ evaluator });
      const model = wrapLanguageModel({
        model: openai.chat("gpt-4o-mini"),
        middleware: [middleware],
      });

      const result = streamText({
        model,
        system: SYSTEM_PROMPT,
        prompt: "Say hello in one word.",
      });

      let text = "";
      for await (const part of result.textStream) {
        text += part;
      }

      expect(text).toBeTruthy();
    });

    it("streamText: agent tool call is evaluated by AI Guard", async () => {
      const middleware = new AIGuardMiddleware({ evaluator });
      const model = wrapLanguageModel({
        model: openai.chat("gpt-4o-mini"),
        middleware: [middleware],
      });

      const result = streamText({
        model,
        system: SYSTEM_PROMPT,
        prompt: "What time is it in Tokyo?",
        tools: timeTools,
        stopWhen: stepCountIs(5),
      });

      const chunks: unknown[] = [];
      for await (const part of result.fullStream) {
        chunks.push(part);
      }

      const toolCallChunk = chunks.find((c) => (c as { type: string }).type === "tool-call");
      expect(toolCallChunk).toBeTruthy();

      const textChunk = chunks.find((c) => (c as { type: string }).type === "text-delta");
      expect(textChunk).toBeTruthy();
    });
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */
