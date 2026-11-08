import type {
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { generateText, streamText, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { type AIGuardEvaluator, AIGuardMiddleware, AIGuardMiddlewareClientError } from "./index.js";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const finishReason = { unified: "stop", raw: "stop" } as const;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const pngUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
const logger = { info() {}, warn() {}, error() {} };

function evaluator() {
  return {
    evaluate: vi.fn<AIGuardEvaluator["evaluate"]>().mockResolvedValue({
      action: "ALLOW",
      reason: "",
      tags: [],
      tagProbabilities: {},
      sds: [],
      messages: [],
      redactionReplacements: [],
    }),
  };
}

function result(content: LanguageModelV4Content[]): LanguageModelV4GenerateResult {
  return {
    content,
    finishReason,
    usage,
    warnings: [],
    providerMetadata: { test: { preserved: true } },
  };
}

describe("V4 image evaluation and unchanged evaluation scope", () => {
  it.each(["generate", "stream"] as const)(
    "evaluates an image prompt through SDK %s",
    async (mode) => {
      const guard = evaluator();
      const raw = new MockLanguageModelV4({
        doGenerate: result([{ type: "text", text: "Hello" }]),
        doStream: {
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "finish", finishReason, usage });
              controller.close();
            },
          }),
        },
      });
      const model = wrapLanguageModel({
        model: raw,
        middleware: new AIGuardMiddleware({ evaluator: guard, logger }),
      });
      const options = {
        model,
        messages: [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Describe" },
              { type: "file" as const, mediaType: "image/png", data: png },
            ],
          },
        ],
      };
      if (mode === "generate") await generateText(options);
      else await streamText(options).consumeStream();
      expect(guard.evaluate.mock.calls[0]?.[0]).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "Describe" },
            { type: "image_url", image_url: { url: pngUrl } },
          ],
        },
      ]);
      const call = mode === "generate" ? raw.doGenerateCalls[0] : raw.doStreamCalls[0];
      expect(call?.prompt[0]).toMatchObject({
        role: "user",
        content: [
          { type: "text", text: "Describe" },
          { type: "file", data: { type: "data", data: png } },
        ],
      });
    },
  );

  it.each([
    { name: "bytes", data: { type: "data" as const, data: png }, url: pngUrl },
    {
      name: "base64",
      data: { type: "data" as const, data: "AQID" },
      url: "data:image/png;base64,AQID",
    },
    {
      name: "URL",
      data: { type: "url" as const, url: new URL("https://example.com/generated.png") },
      url: "https://example.com/generated.png",
    },
  ])("evaluates generated $name images and returns the original result", async ({ data, url }) => {
    const guard = evaluator();
    const output = result([{ type: "file", mediaType: "image/png", data }]);
    const raw = new MockLanguageModelV4({ doGenerate: output });
    const model = wrapLanguageModel({
      model: raw,
      middleware: new AIGuardMiddleware({ evaluator: guard, logger }),
    });
    expect(
      await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Draw" }] }],
      }),
    ).toBe(output);
    expect(guard.evaluate).toHaveBeenCalledTimes(2);
    expect(guard.evaluate.mock.calls[1]?.[0]).toEqual([
      { role: "user", content: "Draw" },
      { role: "assistant", content: [{ type: "image_url", image_url: { url } }] },
    ]);
    expect(output.content[0]).toMatchObject({ type: "file", data });
  });

  it("does not add output evaluation for streaming images, reasoning or custom content", async () => {
    const guard = evaluator();
    const chunks: LanguageModelV4StreamPart[] = [
      { type: "stream-start", warnings: [] },
      { type: "file", mediaType: "image/png", data: { type: "data", data: png } },
      { type: "reasoning-file", mediaType: "image/png", data: { type: "data", data: png } },
      { type: "custom", kind: "test.private", providerMetadata: { test: { value: "opaque" } } },
      { type: "finish", finishReason, usage },
    ];
    const raw = new MockLanguageModelV4({
      doStream: {
        stream: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
      },
    });
    const model = wrapLanguageModel({
      model: raw,
      middleware: new AIGuardMiddleware({ evaluator: guard, allowOnFailure: false, logger }),
    });
    const output = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    });
    const received: LanguageModelV4StreamPart[] = [];
    for await (const chunk of output.stream) received.push(chunk);
    expect(received).toEqual(chunks);
    expect(guard.evaluate).toHaveBeenCalledTimes(1);
  });

  it("does not block existing unevaluated file and reasoning formats in fail-closed mode", async () => {
    const guard = evaluator();
    const output = result([
      { type: "reasoning", text: "Private reasoning" },
      { type: "reasoning-file", mediaType: "image/png", data: { type: "data", data: png } },
      { type: "custom", kind: "test.private" },
      { type: "file", mediaType: "application/pdf", data: { type: "data", data: "AQID" } },
    ]);
    const raw = new MockLanguageModelV4({ doGenerate: output });
    const model = wrapLanguageModel({
      model: raw,
      middleware: new AIGuardMiddleware({ evaluator: guard, allowOnFailure: false, logger }),
    });
    expect(
      await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [
              { type: "text", text: "Hello" },
              {
                type: "file",
                mediaType: "image/png",
                data: { type: "reference", reference: { openai: "file-1" } },
              },
            ],
          },
        ],
      }),
    ).toBe(output);
    expect(guard.evaluate).toHaveBeenCalledTimes(1);
    expect(guard.evaluate.mock.calls[0]?.[0]).toEqual([{ role: "user", content: "Hello" }]);
  });

  it.each([true, false])(
    "applies allowOnFailure=%s to an unreadable V4 response",
    async (allowOnFailure) => {
      const guard = evaluator();
      const output = result([
        {
          type: "file",
          mediaType: "image/png",
          data: {
            type: "data",
            get data(): string {
              throw new Error("private file details");
            },
          },
        },
      ]);
      const raw = new MockLanguageModelV4({ doGenerate: output });
      const model = wrapLanguageModel({
        model: raw,
        middleware: new AIGuardMiddleware({ evaluator: guard, allowOnFailure, logger }),
      });
      const promise = model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      });
      if (allowOnFailure) await expect(promise).resolves.toBe(output);
      else {
        await expect(promise).rejects.toBeInstanceOf(AIGuardMiddlewareClientError);
        await expect(promise).rejects.not.toHaveProperty("message", "private file details");
      }
      expect(guard.evaluate).toHaveBeenCalledTimes(1);
    },
  );
});
