import { openai } from "@ai-sdk/openai";
import { generateText, streamText, wrapLanguageModel } from "ai";
import { type AIGuardEvaluator, AIGuardMiddleware } from "../dist/index.js";

export async function generateWithPublicTypes(evaluator: AIGuardEvaluator): Promise<string> {
  const model = wrapLanguageModel({
    model: openai("gpt-4o-mini"),
    middleware: new AIGuardMiddleware({ evaluator }),
  });
  return (await generateText({ model, instructions: "Be concise.", prompt: "Hello" })).text;
}

export function streamWithPublicTypes(evaluator: AIGuardEvaluator) {
  const model = wrapLanguageModel({
    model: openai("gpt-4o-mini"),
    middleware: new AIGuardMiddleware({ evaluator }),
  });
  return streamText({ model, prompt: "Hello" }).stream;
}
