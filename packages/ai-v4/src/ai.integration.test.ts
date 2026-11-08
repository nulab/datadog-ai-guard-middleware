import { openai } from "@ai-sdk/openai";
import { defineIntegrationTests } from "@nulab/datadog-ai-guard-middleware-internal/testing";
import { generateText, jsonSchema, stepCountIs, streamText, tool, wrapLanguageModel } from "ai";
import { type AIGuardEvaluator, AIGuardMiddleware } from "./ai.js";

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

function options(evaluator: AIGuardEvaluator, toolCall: boolean) {
  return {
    model: wrapLanguageModel({
      model: openai.chat("gpt-4o-mini"),
      middleware: new AIGuardMiddleware({ evaluator }),
    }),
    instructions: SYSTEM_PROMPT,
    prompt: toolCall ? "What time is it in Tokyo?" : "Say hello in one word.",
    tools: toolCall ? timeTools : undefined,
    stopWhen: stepCountIs(5),
  };
}

defineIntegrationTests({
  async generate(evaluator, toolCall) {
    const result = await generateText(options(evaluator, toolCall));
    return {
      text: result.text,
      toolNames: result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
      stepCount: result.steps.length,
    };
  },
  async stream(evaluator, toolCall) {
    const result = streamText(options(evaluator, toolCall));
    let text = "";
    const toolNames: string[] = [];
    for await (const part of result.stream) {
      if (part.type === "error") throw part.error;
      if (part.type === "text-delta") text += part.text;
      if (part.type === "tool-call") toolNames.push(part.toolName);
    }
    return { text, toolNames };
  },
});
