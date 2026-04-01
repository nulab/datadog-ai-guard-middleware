import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface MockEvaluator {
  evaluate: Mock<(messages: any, options: any) => any>;
}

export interface AIGuardMiddlewareTestDeps {
  AIGuardMiddleware: new (opts: any) => any;
  AIGuardMiddlewareAbortError: new (...args: any[]) => any;
  castCallOptions: (opts: any) => any;
}

function createSDKAbortError(reason: string, tags?: string[]): Error {
  const error = new Error(reason);
  error.name = "AIGuardAbortError";
  Object.assign(error, { reason, tags });
  return error;
}

function createMockStream<T>(chunks: T[]): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function consumeStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const chunks: T[] = [];
  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    if (result.value) chunks.push(result.value);
  }
  return chunks;
}

function findErrorChunk(chunks: unknown[]): { type: string; error: Error } {
  const errorChunk = chunks.find((c) => (c as { type: string }).type === "error") as
    | { type: string; error: Error }
    | undefined;
  expect(errorChunk).toBeTruthy();
  return errorChunk!;
}

export function defineAIGuardMiddlewareTests(deps: AIGuardMiddlewareTestDeps): void {
  const { AIGuardMiddleware, AIGuardMiddlewareAbortError, castCallOptions } = deps;

  const basePrompt = [{ role: "user", content: "Hello" }] as any;
  const model = {} as any;
  const doStreamStub = () => vi.fn();

  function callWrapGenerate(mw: any, doGenerate: any, params: { prompt: unknown }) {
    return mw.wrapGenerate({
      doGenerate,
      doStream: doStreamStub(),
      params: params as any,
      model,
    });
  }

  function createDoStreamMock(streamChunks: unknown[]) {
    return vi.fn().mockResolvedValue({
      stream: createMockStream(streamChunks),
      response: { headers: {} },
    });
  }

  function callWrapStream(mw: any, doStream: any, params: { prompt: unknown }) {
    return mw.wrapStream({
      doGenerate: doStreamStub(),
      doStream,
      params: params as any,
      model,
    });
  }

  describe("AIGuardMiddleware", () => {
    let evaluator: MockEvaluator;
    let middleware: any;

    beforeEach(() => {
      evaluator = {
        evaluate: vi.fn(),
      };
    });

    describe("constructor", () => {
      it("should throw TypeError if evaluator is not provided", () => {
        // @ts-expect-error testing runtime validation
        expect(() => new AIGuardMiddleware({})).toThrow("AIGuardMiddleware: evaluator is required");
      });

      it("should throw TypeError if evaluator is undefined", () => {
        // @ts-expect-error testing runtime validation
        expect(() => new AIGuardMiddleware({ evaluator: undefined })).toThrow(
          "AIGuardMiddleware: evaluator is required",
        );
      });

      it("should create instance with valid options", () => {
        const mw = new AIGuardMiddleware({ evaluator });
        expect(mw).toBeInstanceOf(AIGuardMiddleware);
      });

      it("should default allowOnFailure to true (verified via behavior)", async () => {
        evaluator.evaluate.mockRejectedValue(new Error("Network error"));
        const mw = new AIGuardMiddleware({ evaluator });

        const mockResult = { content: [] };
        const doGenerate = vi.fn().mockResolvedValue(mockResult);
        const result = await callWrapGenerate(mw, doGenerate, { prompt: basePrompt });

        expect(result).toStrictEqual(mockResult);
      });

      it("should accept allowOnFailure=false option (verified via behavior)", async () => {
        evaluator.evaluate.mockRejectedValue(new Error("Network error"));
        const mw = new AIGuardMiddleware({ evaluator, allowOnFailure: false });

        const doGenerate = vi.fn().mockResolvedValue({ content: [] });

        await expect(callWrapGenerate(mw, doGenerate, { prompt: basePrompt })).rejects.toMatchObject({
          name: "AIGuardMiddlewareClientError",
        });
      });
    });

    describe("wrapGenerate - prompt evaluation", () => {
      const prompt = [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Hello, how are you?" },
      ];
      let doGenerate: ReturnType<typeof vi.fn>;
      const params = { prompt };
      const mockResult = { content: [{ type: "text", text: "I am fine, thank you!" }] } as const;

      beforeEach(() => {
        doGenerate = vi.fn().mockResolvedValue(mockResult);
      });

      it("should call SDK.evaluate with { block: true }", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator });

        await callWrapGenerate(middleware, doGenerate, params);

        expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
        expect(evaluator.evaluate.mock.calls[0][1]).toStrictEqual({ block: true });
        expect(evaluator.evaluate.mock.calls[1][1]).toStrictEqual({ block: true });
      });

      it("should pass image file parts to AI Guard as image_url content parts", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator });

        const multimodalParams = castCallOptions({
          prompt: [
            { role: "system", content: "You are a helpful assistant" },
            {
              role: "user",
              content: [
                { type: "text", text: "What is in this image?" },
                {
                  type: "file",
                  mediaType: "image/png",
                  data: "https://example.com/cat.png",
                },
              ],
            },
          ],
        });

        await callWrapGenerate(middleware, doGenerate, multimodalParams);

        expect(evaluator.evaluate).toHaveBeenCalledWith(
          [
            { role: "system", content: "You are a helpful assistant" },
            {
              role: "user",
              content: [
                { type: "text", text: "What is in this image?" },
                { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
              ],
            },
          ],
          { block: true },
        );
      });

      it("should allow request when SDK returns without exception", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator });

        const result = await callWrapGenerate(middleware, doGenerate, params);

        expect(result).toStrictEqual(mockResult);
        expect(doGenerate).toHaveBeenCalledTimes(1);
        expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
      });

      it("should evaluate assistant text-only response in a second SDK.evaluate call", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator });

        await callWrapGenerate(middleware, doGenerate, params);

        expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
        expect(evaluator.evaluate.mock.calls[1][0]).toStrictEqual([
          { role: "system", content: "You are a helpful assistant" },
          { role: "user", content: "Hello, how are you?" },
          { role: "assistant", content: "I am fine, thank you!" },
        ]);
      });

      it("should allow request and warn when assistant response returns DENY without throwing", async () => {
        evaluator.evaluate
          .mockResolvedValueOnce({ action: "ALLOW", reason: "" })
          .mockResolvedValueOnce({ action: "DENY", reason: "Blocked by policy" });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        middleware = new AIGuardMiddleware({ evaluator });

        const result = await callWrapGenerate(middleware, doGenerate, params);

        expect(result).toStrictEqual(mockResult);
        expect(doGenerate).toHaveBeenCalledTimes(1);
        expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "Datadog returned action=%s without blocking; request will continue. Check AI Guard blocking policy for this service/environment (%sms)",
          ),
          expect.stringContaining("Assistant response"),
          "DENY",
          expect.any(String),
        );
      });

      it("should throw AIGuardMiddlewareAbortError when SDK throws AIGuardAbortError for assistant response", async () => {
        evaluator.evaluate
          .mockResolvedValueOnce({ action: "ALLOW", reason: "" })
          .mockRejectedValueOnce(createSDKAbortError("Sensitive content detected", ["pii"]));
        middleware = new AIGuardMiddleware({ evaluator });

        await expect(callWrapGenerate(middleware, doGenerate, params)).rejects.toMatchObject({
          name: "AIGuardMiddlewareAbortError",
          code: "AI_GUARD_MIDDLEWARE_ABORT",
          kind: "Assistant response",
        });
        expect(doGenerate).toHaveBeenCalledTimes(1);
      });

      it("should throw AIGuardMiddlewareAbortError when SDK throws AIGuardAbortError", async () => {
        evaluator.evaluate.mockRejectedValue(
          createSDKAbortError("Sensitive content detected", ["pii"]),
        );
        middleware = new AIGuardMiddleware({ evaluator });

        await expect(callWrapGenerate(middleware, doGenerate, params)).rejects.toMatchObject({
          name: "AIGuardMiddlewareAbortError",
          code: "AI_GUARD_MIDDLEWARE_ABORT",
          kind: "Prompt",
        });
        expect(doGenerate).toHaveBeenCalledTimes(0);
      });

      it("AIGuardMiddlewareAbortError should not expose sensitive fields (security)", async () => {
        evaluator.evaluate.mockRejectedValue(createSDKAbortError("Sensitive reason", ["injection"]));
        middleware = new AIGuardMiddleware({ evaluator });

        try {
          await callWrapGenerate(middleware, doGenerate, params);
          expect.fail("Expected error to be thrown");
        } catch (error) {
          expect(Object.hasOwn(error as object, "reason")).toBe(false);
          expect(Object.hasOwn(error as object, "tags")).toBe(false);
          expect(Object.hasOwn(error as object, "cause")).toBe(false);

          const json = JSON.stringify(error);
          expect(json).not.toContain('"reason"');
          expect(json).not.toContain('"tags"');
        }
      });
    });

    describe("wrapGenerate - tool call evaluation", () => {
      const prompt = [{ role: "user", content: "What is the weather in Tokyo?" }];
      const params = { prompt };

      it("should evaluate an assistant turn with tool calls in a single SDK.evaluate call", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator });

        const content = [
          {
            type: "text",
            text: "I'll check the latest weather for Tokyo.",
          },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "getWeather",
            input: JSON.stringify({ city: "Tokyo" }),
          },
        ];

        const doGenerate = vi.fn().mockResolvedValue({ content });

        await callWrapGenerate(middleware, doGenerate, params);

        expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
        expect(evaluator.evaluate.mock.calls[0][1]).toStrictEqual({ block: true });
        expect(evaluator.evaluate.mock.calls[1][1]).toStrictEqual({ block: true });
        expect(evaluator.evaluate.mock.calls[1][0]).toStrictEqual([
          { role: "user", content: "What is the weather in Tokyo?" },
          { role: "assistant", content: "I'll check the latest weather for Tokyo." },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "getWeather",
                  arguments: '{"city":"Tokyo"}',
                },
              },
            ],
          },
        ]);
      });

      it("should throw AIGuardMiddlewareAbortError when SDK throws AIGuardAbortError for tool call", async () => {
        evaluator.evaluate
          .mockResolvedValueOnce({ action: "ALLOW", reason: "" })
          .mockRejectedValueOnce(createSDKAbortError("Dangerous operation", ["injection"]));
        middleware = new AIGuardMiddleware({ evaluator });

        const content = [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "deleteFile",
            input: JSON.stringify({ path: "/etc/passwd" }),
          },
        ];

        const doGenerate = vi.fn().mockResolvedValue({ content });

        await expect(callWrapGenerate(middleware, doGenerate, params)).rejects.toMatchObject({
          name: "AIGuardMiddlewareAbortError",
          code: "AI_GUARD_MIDDLEWARE_ABORT",
          kind: "Tool call",
        });
      });

      it("should evaluate sibling tool calls together in one assistant-turn request", async () => {
        evaluator.evaluate
          .mockResolvedValueOnce({ action: "ALLOW", reason: "" })
          .mockRejectedValueOnce(createSDKAbortError("Blocked", []));
        middleware = new AIGuardMiddleware({ evaluator });

        const content = [
          { type: "text", text: "I need to call two tools before answering." },
          { type: "tool-call", toolCallId: "call_1", toolName: "safeOp", input: "{}" },
          { type: "tool-call", toolCallId: "call_2", toolName: "dangerousOp", input: "{}" },
        ];

        const doGenerate = vi.fn().mockResolvedValue({ content });

        await expect(callWrapGenerate(middleware, doGenerate, params)).rejects.toMatchObject({
          name: "AIGuardMiddlewareAbortError",
        });

        expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
        expect(evaluator.evaluate.mock.calls[1][0]).toStrictEqual([
          { role: "user", content: "What is the weather in Tokyo?" },
          { role: "assistant", content: "I need to call two tools before answering." },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "safeOp",
                  arguments: "{}",
                },
              },
              {
                id: "call_2",
                function: {
                  name: "dangerousOp",
                  arguments: "{}",
                },
              },
            ],
          },
        ]);
      });

      it("should continue and warn when tool call returns ABORT without throwing", async () => {
        evaluator.evaluate
          .mockResolvedValueOnce({ action: "ALLOW", reason: "" })
          .mockResolvedValueOnce({ action: "ABORT", reason: "Blocked by policy" });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        middleware = new AIGuardMiddleware({ evaluator });

        const content = [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "dangerousTool",
            input: JSON.stringify({ command: "shutdown" }),
          },
        ];

        const doGenerate = vi.fn().mockResolvedValue({ content });

        const result = await callWrapGenerate(middleware, doGenerate, params);

        expect(result).toStrictEqual({ content });
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "Datadog returned action=%s without blocking; request will continue. Check AI Guard blocking policy for this service/environment (%sms)",
          ),
          expect.stringContaining("Tool call"),
          "ABORT",
          expect.any(String),
        );
      });
    });

    describe("wrapGenerate - evaluation failure handling", () => {
      const prompt = [{ role: "user", content: "Hello" }];
      const params = { prompt };
      let doGenerate: ReturnType<typeof vi.fn>;
      const mockResult = { content: [] };

      beforeEach(() => {
        doGenerate = vi.fn().mockResolvedValue(mockResult);
      });

      it("allowOnFailure=true allows request when evaluation fails", async () => {
        evaluator.evaluate.mockRejectedValue(new Error("Network error"));
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: true });

        const result = await callWrapGenerate(middleware, doGenerate, params);

        expect(result).toStrictEqual(mockResult);
      });

      it("allowOnFailure=true logs evaluation failure as a warning", async () => {
        evaluator.evaluate.mockRejectedValue(new Error("Network error"));
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: true });

        const result = await callWrapGenerate(middleware, doGenerate, params);

        expect(result).toStrictEqual(mockResult);
        expect(warnSpy).toHaveBeenCalledWith(
          "[AI Guard] %s — unavailable (%s); request will continue because allowOnFailure=%s",
          "Prompt (roles=[user])",
          expect.stringContaining("evaluation failed after "),
          true,
        );
        expect(warnSpy).toHaveBeenCalledWith(
          "[AI Guard] %s — unavailable (%s); request will continue because allowOnFailure=%s",
          "Prompt (roles=[user])",
          expect.stringContaining("Network error"),
          true,
        );
        expect(errorSpy).not.toHaveBeenCalled();
      });

      it("allowOnFailure=false throws AIGuardMiddlewareClientError when evaluation fails", async () => {
        evaluator.evaluate.mockRejectedValue(new Error("Service unavailable"));
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: false });

        await expect(callWrapGenerate(middleware, doGenerate, params)).rejects.toMatchObject({
          name: "AIGuardMiddlewareClientError",
          code: "AI_GUARD_MIDDLEWARE_CLIENT_ERROR",
          message: "AI Guard evaluation failed",
        });
      });

      it("allowOnFailure=false logs evaluation failure as an error", async () => {
        evaluator.evaluate.mockRejectedValue(new Error("Service unavailable"));
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: false });

        await expect(callWrapGenerate(middleware, doGenerate, params)).rejects.toMatchObject({
          name: "AIGuardMiddlewareClientError",
        });

        expect(errorSpy).toHaveBeenCalledWith(
          "[AI Guard] %s — unavailable (%s); rejecting request because allowOnFailure=%s",
          "Prompt (roles=[user])",
          expect.stringContaining("evaluation failed after "),
          false,
        );
        expect(errorSpy).toHaveBeenCalledWith(
          "[AI Guard] %s — unavailable (%s); rejecting request because allowOnFailure=%s",
          "Prompt (roles=[user])",
          expect.stringContaining("Service unavailable"),
          false,
        );
      });

      it("AIGuardMiddlewareClientError should not expose original error (security)", async () => {
        evaluator.evaluate.mockRejectedValue(new Error("Internal: connection string"));
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: false });

        try {
          await callWrapGenerate(middleware, doGenerate, params);
          expect.fail("Expected error to be thrown");
        } catch (error) {
          expect(Object.hasOwn(error as object, "cause")).toBe(false);
          expect((error as Error).cause).toBeUndefined();

          const json = JSON.stringify(error);
          expect(json).not.toContain('"cause"');
        }
      });

      it("should allow request and skip later guard checks when prompt conversion fails and allowOnFailure=true", async () => {
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: true });
        const invalidPrompt = [
          { role: "user", content: "Hello" },
          {
            role: "assistant",
            content: [{ type: "tool-call", toolName: "missingId", input: "{}" }],
          },
        ];
        const content = [
          { type: "tool-call", toolCallId: "call_1", toolName: "safeOp", input: "{}" },
        ];
        doGenerate = vi.fn().mockResolvedValue({ content });

        const result = await callWrapGenerate(middleware, doGenerate, { prompt: invalidPrompt });

        expect(result).toStrictEqual({ content });
        expect(evaluator.evaluate).not.toHaveBeenCalled();
      });

      it("should throw before model execution when prompt conversion fails and allowOnFailure=false", async () => {
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: false });
        const invalidPrompt = [
          { role: "user", content: "Hello" },
          {
            role: "assistant",
            content: [{ type: "tool-call", toolName: "missingId", input: "{}" }],
          },
        ];
        const doGenerateSpy = vi.fn();

        await expect(
          callWrapGenerate(middleware, doGenerateSpy, { prompt: invalidPrompt }),
        ).rejects.toMatchObject({
          name: "AIGuardMiddlewareClientError",
          code: "AI_GUARD_MIDDLEWARE_CLIENT_ERROR",
        });

        expect(doGenerateSpy).toHaveBeenCalledTimes(0);
        expect(evaluator.evaluate).not.toHaveBeenCalled();
      });

      it("should allow request when assistant response conversion fails and allowOnFailure=true", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: true });
        const content = [{ type: "tool-call", toolName: "missingId", input: "{}" }];
        doGenerate = vi.fn().mockResolvedValue({ content });

        const result = await callWrapGenerate(middleware, doGenerate, params);

        expect(result).toStrictEqual({ content });
        expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
      });

      it("should throw AIGuardMiddlewareClientError when assistant response conversion fails and allowOnFailure=false", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: false });
        const content = [{ type: "tool-call", toolName: "missingId", input: "{}" }];
        doGenerate = vi.fn().mockResolvedValue({ content });

        await expect(callWrapGenerate(middleware, doGenerate, params)).rejects.toMatchObject({
          name: "AIGuardMiddlewareClientError",
          code: "AI_GUARD_MIDDLEWARE_CLIENT_ERROR",
        });

        expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
      });
    });

    describe("wrapStream - prompt evaluation", () => {
      const prompt = [{ role: "user", content: "Tell me a story" }];
      const params = { prompt };

      it("should evaluate prompt before streaming", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator });

        const doStream = createDoStreamMock([{ type: "text-delta", textDelta: "Hello" }]);

        const result = await callWrapStream(middleware, doStream, params);

        expect(result.stream).toBeTruthy();
        expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
      });

      it("should throw AIGuardMiddlewareAbortError when SDK throws AIGuardAbortError for prompt", async () => {
        evaluator.evaluate.mockRejectedValue(createSDKAbortError("Blocked prompt", ["malicious"]));
        middleware = new AIGuardMiddleware({ evaluator });

        const doStream = vi.fn();

        await expect(callWrapStream(middleware, doStream, params)).rejects.toMatchObject({
          name: "AIGuardMiddlewareAbortError",
          kind: "Prompt",
        });
        expect(doStream).toHaveBeenCalledTimes(0);
      });
      it("should allow stream and skip later guard checks when prompt conversion fails and allowOnFailure=true", async () => {
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: true });
        const invalidPrompt = [
          { role: "user", content: "Tell me a story" },
          {
            role: "assistant",
            content: [{ type: "tool-call", toolName: "missingId", input: "{}" }],
          },
        ];

        const doStream = createDoStreamMock([
          { type: "text-delta", textDelta: "Hello" },
          { type: "tool-call", toolCallId: "call_1", toolName: "nextStep", input: "{}" },
        ]);

        const result = await callWrapStream(middleware, doStream, { prompt: invalidPrompt });

        const chunks = await consumeStream(result.stream);

        expect(chunks).toHaveLength(2);
        expect(evaluator.evaluate).not.toHaveBeenCalled();
      });

      it("should throw before stream creation when prompt conversion fails and allowOnFailure=false", async () => {
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: false });
        const invalidPrompt = [
          { role: "user", content: "Tell me a story" },
          {
            role: "assistant",
            content: [{ type: "tool-call", toolName: "missingId", input: "{}" }],
          },
        ];
        const doStream = vi.fn();

        await expect(
          callWrapStream(middleware, doStream, { prompt: invalidPrompt }),
        ).rejects.toMatchObject({
          name: "AIGuardMiddlewareClientError",
          code: "AI_GUARD_MIDDLEWARE_CLIENT_ERROR",
        });

        expect(doStream).toHaveBeenCalledTimes(0);
        expect(evaluator.evaluate).not.toHaveBeenCalled();
      });
    });

    describe("wrapStream - tool call evaluation", () => {
      const prompt = [{ role: "user", content: "Get weather" }];
      const params = { prompt };

      it("should evaluate tool-call chunks with SDK.evaluate({ block: true })", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator });

        const doStream = createDoStreamMock([
          { type: "text-delta", textDelta: "Checking..." },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "getWeather",
            input: JSON.stringify({ city: "Tokyo" }),
          },
          { type: "text-delta", textDelta: "Done!" },
        ]);

        const result = await callWrapStream(middleware, doStream, params);

        const chunks = await consumeStream(result.stream);

        expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
        expect(evaluator.evaluate.mock.calls[1][0]).toStrictEqual([
          { role: "user", content: "Get weather" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "getWeather",
                  arguments: '{"city":"Tokyo"}',
                },
              },
            ],
          },
        ]);
        expect(chunks).toHaveLength(3);
      });

      it("should continue streaming when tool call conversion fails and allowOnFailure=true", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: true });

        const doStream = createDoStreamMock([
          { type: "text-delta", textDelta: "Before invalid" },
          {
            type: "tool-call",
            toolCallId: "call_invalid",
            input: "{}",
          },
          { type: "text-delta", textDelta: "Before valid" },
          {
            type: "tool-call",
            toolCallId: "call_valid",
            toolName: "getWeather",
            input: JSON.stringify({ city: "Tokyo" }),
          },
        ]);

        const result = await callWrapStream(middleware, doStream, params);

        const chunks = await consumeStream(result.stream);

        expect(chunks).toHaveLength(4);
        expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
        expect(evaluator.evaluate.mock.calls[1][0]).toStrictEqual([
          { role: "user", content: "Get weather" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_valid",
                function: {
                  name: "getWeather",
                  arguments: '{"city":"Tokyo"}',
                },
              },
            ],
          },
        ]);
      });

      it("should emit an error chunk when tool call conversion fails and allowOnFailure=false", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: false });

        const doStream = createDoStreamMock([
          {
            type: "tool-call",
            toolCallId: "call_invalid",
            input: "{}",
          },
          { type: "text-delta", textDelta: "Should not appear" },
        ]);

        const result = await callWrapStream(middleware, doStream, params);

        const chunks = await consumeStream(result.stream);
        const errorChunk = findErrorChunk(chunks);

        expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
        expect(chunks).toHaveLength(1);
        expect(errorChunk.error.name).toBe("AIGuardStreamTripWire");
        expect(errorChunk.error.message).toBe("AI Guard evaluation failed");
      });

      it("should allow stream to continue and warn when tool call returns DENY without throwing", async () => {
        evaluator.evaluate
          .mockResolvedValueOnce({ action: "ALLOW", reason: "" })
          .mockResolvedValueOnce({ action: "DENY", reason: "Blocked by policy" });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        middleware = new AIGuardMiddleware({ evaluator });

        const doStream = createDoStreamMock([
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "dangerousTool",
            input: JSON.stringify({ command: "shutdown" }),
          },
          { type: "text-delta", textDelta: "Still running" },
        ]);

        const result = await callWrapStream(middleware, doStream, params);

        const chunks = await consumeStream(result.stream);

        expect(chunks).toHaveLength(2);
        expect((chunks[0] as { type: string }).type).toBe("tool-call");
        expect((chunks[1] as { type: string }).type).toBe("text-delta");
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "Datadog returned action=%s without blocking; request will continue. Check AI Guard blocking policy for this service/environment (%sms)",
          ),
          expect.stringContaining("Tool call"),
          "DENY",
          expect.any(String),
        );
      });

      it("should accumulate sibling tool calls so later evaluations include preceding calls", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator });

        const doStream = createDoStreamMock([
          { type: "text-delta", textDelta: "Let me check..." },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "readFile",
            input: JSON.stringify({ path: "/etc/passwd" }),
          },
          {
            type: "tool-call",
            toolCallId: "call_2",
            toolName: "sendEmail",
            input: JSON.stringify({ to: "external@example.com" }),
          },
          {
            type: "tool-call",
            toolCallId: "call_3",
            toolName: "deleteFile",
            input: JSON.stringify({ path: "/tmp/data" }),
          },
        ]);

        const result = await callWrapStream(middleware, doStream, params);

        const chunks = await consumeStream(result.stream);

        expect(evaluator.evaluate).toHaveBeenCalledTimes(4);
        expect(chunks).toHaveLength(4);

        expect(evaluator.evaluate.mock.calls[1][0]).toStrictEqual([
          { role: "user", content: "Get weather" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                function: { name: "readFile", arguments: '{"path":"/etc/passwd"}' },
              },
            ],
          },
        ]);

        expect(evaluator.evaluate.mock.calls[2][0]).toStrictEqual([
          { role: "user", content: "Get weather" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                function: { name: "readFile", arguments: '{"path":"/etc/passwd"}' },
              },
              {
                id: "call_2",
                function: { name: "sendEmail", arguments: '{"to":"external@example.com"}' },
              },
            ],
          },
        ]);

        expect(evaluator.evaluate.mock.calls[3][0]).toStrictEqual([
          { role: "user", content: "Get weather" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                function: { name: "readFile", arguments: '{"path":"/etc/passwd"}' },
              },
              {
                id: "call_2",
                function: { name: "sendEmail", arguments: '{"to":"external@example.com"}' },
              },
              {
                id: "call_3",
                function: { name: "deleteFile", arguments: '{"path":"/tmp/data"}' },
              },
            ],
          },
        ]);
      });

      it("should reset accumulated tool calls on finish chunk", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator });

        const doStream = createDoStreamMock([
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "readFile",
            input: JSON.stringify({ path: "/tmp/a" }),
          },
          { type: "finish", finishReason: "stop" },
          {
            type: "tool-call",
            toolCallId: "call_2",
            toolName: "writeFile",
            input: JSON.stringify({ path: "/tmp/b" }),
          },
        ]);

        const result = await callWrapStream(middleware, doStream, params);

        const chunks = await consumeStream(result.stream);
        expect(chunks).toHaveLength(3);
        expect(evaluator.evaluate).toHaveBeenCalledTimes(3);

        expect(evaluator.evaluate.mock.calls[2][0]).toStrictEqual([
          { role: "user", content: "Get weather" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_2",
                function: { name: "writeFile", arguments: '{"path":"/tmp/b"}' },
              },
            ],
          },
        ]);
      });

      it("should not accumulate failed tool call conversions into sibling list", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator, allowOnFailure: true });

        const doStream = createDoStreamMock([
          {
            type: "tool-call",
            toolCallId: "call_invalid",
            input: "{}",
          },
          {
            type: "tool-call",
            toolCallId: "call_valid",
            toolName: "getWeather",
            input: JSON.stringify({ city: "Tokyo" }),
          },
        ]);

        const result = await callWrapStream(middleware, doStream, params);

        const chunks = await consumeStream(result.stream);
        expect(chunks).toHaveLength(2);

        expect(evaluator.evaluate).toHaveBeenCalledTimes(2);

        expect(evaluator.evaluate.mock.calls[1][0]).toStrictEqual([
          { role: "user", content: "Get weather" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_valid",
                function: { name: "getWeather", arguments: '{"city":"Tokyo"}' },
              },
            ],
          },
        ]);
      });

      it("should insert error chunk when SDK throws AIGuardAbortError", async () => {
        evaluator.evaluate
          .mockResolvedValueOnce({ action: "ALLOW", reason: "" })
          .mockRejectedValueOnce(createSDKAbortError("Blocked tool", ["dangerous"]));
        middleware = new AIGuardMiddleware({ evaluator });

        const doStream = createDoStreamMock([
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "dangerousTool",
            input: "{}",
          },
          { type: "text-delta", textDelta: "Should not appear" },
        ]);

        const result = await callWrapStream(middleware, doStream, params);

        const chunks = await consumeStream(result.stream);

        const errorChunk = findErrorChunk(chunks);
        expect(errorChunk.error.name).toBe("AIGuardStreamTripWire");
      });

      it("AIGuardStreamTripWire error should not expose sensitive fields (security)", async () => {
        evaluator.evaluate
          .mockResolvedValueOnce({ action: "ALLOW", reason: "" })
          .mockRejectedValueOnce(createSDKAbortError("Sensitive reason", ["secret"]));
        middleware = new AIGuardMiddleware({ evaluator });

        const doStream = createDoStreamMock([
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "dangerousTool",
            input: "{}",
          },
        ]);

        const result = await callWrapStream(middleware, doStream, params);

        const chunks = await consumeStream(result.stream);

        const errorChunk = findErrorChunk(chunks);

        expect(Object.hasOwn(errorChunk.error, "reason")).toBe(false);
        expect(Object.hasOwn(errorChunk.error, "tags")).toBe(false);
      });

      it("should allow normal chunks to pass through", async () => {
        evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "" });
        middleware = new AIGuardMiddleware({ evaluator });

        const doStream = createDoStreamMock([
          { type: "text-delta", textDelta: "Hello" },
          { type: "text-delta", textDelta: " World" },
          { type: "finish", finishReason: "stop" },
        ]);

        const result = await callWrapStream(middleware, doStream, params);

        const chunks = await consumeStream(result.stream);

        expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
        expect(chunks).toHaveLength(3);
        expect((chunks[0] as { type: string }).type).toBe("text-delta");
        expect((chunks[1] as { type: string }).type).toBe("text-delta");
        expect((chunks[2] as { type: string }).type).toBe("finish");
      });

      it("should hard-stop stream after tool call violation - no subsequent chunks pass through", async () => {
        evaluator.evaluate
          .mockResolvedValueOnce({ action: "ALLOW", reason: "" })
          .mockRejectedValueOnce(createSDKAbortError("Blocked tool", []));
        middleware = new AIGuardMiddleware({ evaluator });

        const doStream = createDoStreamMock([
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "dangerousTool",
            input: "{}",
          },
          { type: "text-delta", textDelta: "Should not appear 1" },
          { type: "text-delta", textDelta: "Should not appear 2" },
          {
            type: "tool-call",
            toolCallId: "call_2",
            toolName: "anotherTool",
            input: "{}",
          },
        ]);

        const result = await callWrapStream(middleware, doStream, params);

        const chunks = await consumeStream(result.stream);

        expect(chunks).toHaveLength(1);
        expect((chunks[0] as { type: string }).type).toBe("error");
        expect((chunks[0] as { type: string; error: Error }).error.name).toBe(
          "AIGuardStreamTripWire",
        );

        const textDeltas = chunks.filter((c) => (c as { type: string }).type === "text-delta");
        expect(textDeltas).toHaveLength(0);

        const toolCalls = chunks.filter((c) => (c as { type: string }).type === "tool-call");
        expect(toolCalls).toHaveLength(0);
      });
    });

    describe("createAbortError factory injection", () => {
      class CustomAbortError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomAbortError";
        }
      }

      it("should use custom factory when provided", async () => {
        const createAbortError = vi.fn(
          (_kind: string, message: string) => new CustomAbortError(message),
        );
        evaluator.evaluate.mockRejectedValue(createSDKAbortError("blocked"));
        const mw = new AIGuardMiddleware({ evaluator, createAbortError });

        await expect(callWrapGenerate(mw, vi.fn(), { prompt: basePrompt })).rejects.toBeInstanceOf(
          CustomAbortError,
        );

        expect(createAbortError).toHaveBeenCalledWith(
          "Prompt",
          expect.stringContaining("blocked by AI Guard"),
        );
      });

      it("custom error should have AI SDK markers applied by markAsNonRetryable", async () => {
        const createAbortError = vi.fn((_kind: string, message: string) => new Error(message));
        evaluator.evaluate.mockRejectedValue(createSDKAbortError("blocked"));
        const mw = new AIGuardMiddleware({ evaluator, createAbortError });

        try {
          await callWrapGenerate(mw, vi.fn(), { prompt: basePrompt });
          expect.unreachable("should have thrown");
        } catch (error) {
          const sdkMarker = Symbol.for("vercel.ai.error.AI_SDKError");
          const apiCallMarker = Symbol.for("vercel.ai.error.AI_APICallError");
          expect((error as unknown as Record<symbol, unknown>)[sdkMarker]).toBe(true);
          expect((error as unknown as Record<symbol, unknown>)[apiCallMarker]).toBe(true);
          expect((error as unknown as Record<string, unknown>).isRetryable).toBe(false);
        }
      });

      it("should fall back to AIGuardMiddlewareAbortError when no factory provided", async () => {
        evaluator.evaluate.mockRejectedValue(createSDKAbortError("blocked"));
        const mw = new AIGuardMiddleware({ evaluator });

        await expect(callWrapGenerate(mw, vi.fn(), { prompt: basePrompt })).rejects.toBeInstanceOf(
          AIGuardMiddlewareAbortError,
        );
      });

      it("should use custom error in wrapStream tool-call blocking scenario", async () => {
        const createAbortError = vi.fn(
          (_kind: string, message: string) => new CustomAbortError(message),
        );
        evaluator.evaluate
          .mockResolvedValueOnce({ action: "ALLOW", reason: "" })
          .mockRejectedValueOnce(createSDKAbortError("Blocked tool", []));
        const mw = new AIGuardMiddleware({ evaluator, createAbortError });

        const doStream = createDoStreamMock([
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "dangerousTool",
            input: "{}",
          },
        ]);

        const result = await callWrapStream(mw, doStream, { prompt: basePrompt });

        const chunks = await consumeStream(result.stream);
        const errorChunk = findErrorChunk(chunks);

        expect(errorChunk.error.name).toBe("AIGuardStreamTripWire");
        expect(createAbortError).toHaveBeenCalledWith(
          "Tool call",
          expect.stringContaining("blocked by AI Guard"),
        );
      });

      it("should use correct log and stream error messages when custom factory is used in wrapStream", async () => {
        const createAbortError = vi.fn(
          (_kind: string, message: string) => new CustomAbortError(message),
        );
        evaluator.evaluate
          .mockResolvedValueOnce({ action: "ALLOW", reason: "" })
          .mockRejectedValueOnce(createSDKAbortError("Blocked tool", []));
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const mw = new AIGuardMiddleware({ evaluator, createAbortError });

        const doStream = createDoStreamMock([
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "dangerousTool",
            input: "{}",
          },
        ]);

        const result = await callWrapStream(mw, doStream, { prompt: basePrompt });

        const chunks = await consumeStream(result.stream);
        const errorChunk = findErrorChunk(chunks);

        expect(warnSpy).toHaveBeenCalledWith(
          "[AI Guard] wrapStream — tool call blocked, terminating stream",
        );
        expect(errorChunk.error.message).toBe("Tool call blocked by AI Guard security policy");
      });
    });
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */
