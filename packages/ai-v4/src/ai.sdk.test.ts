import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { generateText, jsonSchema, stepCountIs, streamText, tool, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { type AIGuardEvaluator, AIGuardMiddleware, AIGuardMiddlewareAbortError } from "./index.js";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const finishReason = { unified: "stop" as const, raw: "stop" };
const toolCall = {
  type: "tool-call" as const,
  toolCallId: "call-1",
  toolName: "getTime",
  input: '{"timezone":"Asia/Tokyo"}',
};
const tools = {
  getTime: tool({
    inputSchema: jsonSchema<{ timezone: string }>({
      type: "object",
      properties: { timezone: { type: "string" } },
      required: ["timezone"],
      additionalProperties: false,
    }),
  }),
};

function evaluator() {
  return {
    evaluate: vi.fn<AIGuardEvaluator["evaluate"]>().mockResolvedValue({
      action: "ALLOW",
      reason: "test",
      tags: [],
      tagProbabilities: {},
      sds: [],
      messages: [],
      redactionReplacements: [],
    }),
  };
}

function modelFor(
  guard: AIGuardEvaluator,
  content: "text" | "tool" = "text",
  allowOnFailure = true,
) {
  const chunks: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
    ...(content === "tool"
      ? [toolCall]
      : [
          { type: "text-start" as const, id: "text-1" },
          { type: "text-delta" as const, id: "text-1", delta: "Hello" },
          { type: "text-end" as const, id: "text-1" },
        ]),
    { type: "finish", finishReason, usage },
  ];
  const raw = new MockLanguageModelV4({
    doGenerate: {
      content: content === "tool" ? [toolCall] : [{ type: "text", text: "Hello" }],
      finishReason,
      usage,
      warnings: [],
    },
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    }),
  });
  const model: LanguageModelV4 = wrapLanguageModel({
    model: raw,
    middleware: new AIGuardMiddleware({
      evaluator: guard,
      allowOnFailure,
      logger: { info() {}, warn() {}, error() {} },
    }),
  });
  return { model, raw };
}

describe("AI SDK v7 middleware connection", () => {
  it.each([false, true])(
    "evaluates the next tool-result prompt with blocking=%s",
    async (blockResult) => {
      const guard = evaluator();
      const allowed = await guard.evaluate([]);
      guard.evaluate.mockClear();
      guard.evaluate.mockImplementation(async (messages) => {
        if (blockResult && messages.some((message) => message.role === "tool")) {
          throw Object.assign(new Error("Blocked"), { name: "AIGuardAbortError" });
        }
        return allowed;
      });
      const raw = new MockLanguageModelV4({
        doGenerate: async () => ({
          content:
            raw.doGenerateCalls.length === 1 ? [toolCall] : [{ type: "text", text: "It is noon" }],
          finishReason,
          usage,
          warnings: [],
        }),
      });
      const execute = vi.fn(async () => ({ time: "12:00" }));
      const model = wrapLanguageModel({
        model: raw,
        middleware: new AIGuardMiddleware({
          evaluator: guard,
          logger: { info() {}, warn() {}, error() {} },
        }),
      });
      const promise = generateText({
        model,
        prompt: "Time?",
        stopWhen: stepCountIs(2),
        tools: {
          getTime: tool({ ...tools.getTime, execute }),
        },
      });
      if (blockResult) await expect(promise).rejects.toBeInstanceOf(AIGuardMiddlewareAbortError);
      else expect((await promise).text).toBe("It is noon");
      expect(execute).toHaveBeenCalledTimes(1);
      expect(raw.doGenerateCalls).toHaveLength(blockResult ? 1 : 2);
      expect(guard.evaluate.mock.calls[2]?.[0]).toEqual(
        expect.arrayContaining([
          { role: "tool", tool_call_id: "call-1", content: '{"time":"12:00"}' },
        ]),
      );
    },
  );

  it("generates text and evaluates both prompt and response", async () => {
    const guard = evaluator();
    const { model } = modelFor(guard);
    expect((await generateText({ model, prompt: "Hello" })).text).toBe("Hello");
    expect(guard.evaluate).toHaveBeenCalledTimes(2);
    expect(guard.evaluate.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "assistant", content: "Hello" })]),
    );
  });

  it("streams text through the SDK", async () => {
    const guard = evaluator();
    const { model } = modelFor(guard);
    const result = streamText({ model, prompt: "Hello" });
    expect(await result.text).toBe("Hello");
    expect(guard.evaluate).toHaveBeenCalledTimes(1);
  });

  it("evaluates generated tool calls", async () => {
    const guard = evaluator();
    const { model } = modelFor(guard, "tool");
    const result = await generateText({ model, prompt: "Time?", tools });
    expect(result.toolCalls[0]?.toolName).toBe("getTime");
    expect(guard.evaluate.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool_calls: [expect.objectContaining({ id: "call-1" })] }),
      ]),
    );
  });

  it("evaluates streamed tool calls", async () => {
    const guard = evaluator();
    const { model } = modelFor(guard, "tool");
    const result = streamText({ model, prompt: "Time?", tools });
    expect((await result.toolCalls)[0]?.toolName).toBe("getTime");
    expect(guard.evaluate).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("honors allowOnFailure=%s through the SDK", async (allowOnFailure) => {
    const guard = evaluator();
    guard.evaluate.mockRejectedValue(new Error("Evaluator unavailable"));
    const { model, raw } = modelFor(guard, "text", allowOnFailure);
    const result = generateText({ model, prompt: "Hello", maxRetries: 2 });
    if (allowOnFailure) {
      expect((await result).text).toBe("Hello");
      expect(raw.doGenerateCalls).toHaveLength(1);
    } else {
      await expect(result).rejects.toThrow();
      expect(raw.doGenerateCalls).toHaveLength(0);
      expect(guard.evaluate).toHaveBeenCalledTimes(1);
    }
  });

  it("does not retry a blocked prompt", async () => {
    const guard = evaluator();
    guard.evaluate.mockRejectedValue(
      Object.assign(new Error("Blocked"), { name: "AIGuardAbortError" }),
    );
    const { model, raw } = modelFor(guard);
    await expect(generateText({ model, prompt: "Blocked", maxRetries: 2 })).rejects.toBeInstanceOf(
      AIGuardMiddlewareAbortError,
    );
    expect(guard.evaluate).toHaveBeenCalledTimes(1);
    expect(raw.doGenerateCalls).toHaveLength(0);
  });

  it("does not retry a blocked streamed prompt", async () => {
    const guard = evaluator();
    guard.evaluate.mockRejectedValue(
      Object.assign(new Error("Blocked"), { name: "AIGuardAbortError" }),
    );
    const { model, raw } = modelFor(guard);
    const result = streamText({ model, prompt: "Blocked", maxRetries: 2 });
    const errors: unknown[] = [];
    for await (const part of result.stream) {
      if (part.type === "error") errors.push(part.error);
    }
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(AIGuardMiddlewareAbortError);
    expect(guard.evaluate).toHaveBeenCalledTimes(1);
    expect(raw.doStreamCalls).toHaveLength(0);
  });

  it("terminates a blocked streamed tool call without exposing it", async () => {
    const guard = evaluator();
    guard.evaluate
      .mockResolvedValueOnce({
        action: "ALLOW",
        reason: "",
        tags: [],
        tagProbabilities: {},
        sds: [],
        messages: [],
        redactionReplacements: [],
      })
      .mockRejectedValue(Object.assign(new Error("Blocked"), { name: "AIGuardAbortError" }));
    const { model, raw } = modelFor(guard, "tool");
    const result = streamText({ model, prompt: "Time?", tools, maxRetries: 2 });
    const types: string[] = [];
    for await (const part of result.stream) types.push(part.type);
    expect(types).toContain("error");
    expect(types).not.toContain("tool-call");
    expect(raw.doStreamCalls).toHaveLength(1);
    expect(guard.evaluate).toHaveBeenCalledTimes(2);
  });

  it("does not retry a blocked generated tool call", async () => {
    const guard = evaluator();
    guard.evaluate
      .mockResolvedValueOnce({
        action: "ALLOW",
        reason: "",
        tags: [],
        tagProbabilities: {},
        sds: [],
        messages: [],
        redactionReplacements: [],
      })
      .mockRejectedValue(Object.assign(new Error("Blocked"), { name: "AIGuardAbortError" }));
    const { model, raw } = modelFor(guard, "tool");
    await expect(
      generateText({ model, prompt: "Time?", tools, maxRetries: 2 }),
    ).rejects.toBeInstanceOf(AIGuardMiddlewareAbortError);
    expect(raw.doGenerateCalls).toHaveLength(1);
    expect(guard.evaluate).toHaveBeenCalledTimes(2);
  });
});
