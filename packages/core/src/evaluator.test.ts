import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIGuardAbortError, AIGuardClientError, AIGuardStreamTripWire } from "./errors.js";
import {
  AIGuardEvaluationEngine,
  getErrorMessage,
  hasMeaningfulAssistantMessages,
  normalizeAIGuardAction,
} from "./evaluator.js";
import type { AIGuardEvaluator, AIGuardKind } from "./types.js";

interface MockEvaluator {
  evaluate: Mock<AIGuardEvaluator["evaluate"]>;
}

function createSDKAbortError(reason: string): Error {
  const error = new Error(reason);
  error.name = "AIGuardAbortError";
  return error;
}

describe("normalizeAIGuardAction", () => {
  it("should return ALLOW for 'ALLOW'", () => {
    expect(normalizeAIGuardAction("ALLOW")).toBe("ALLOW");
  });

  it("should return DENY for 'DENY'", () => {
    expect(normalizeAIGuardAction("DENY")).toBe("DENY");
  });

  it("should return ABORT for 'ABORT'", () => {
    expect(normalizeAIGuardAction("ABORT")).toBe("ABORT");
  });

  it("should return undefined for unknown values", () => {
    expect(normalizeAIGuardAction("UNKNOWN")).toBeUndefined();
    expect(normalizeAIGuardAction(null)).toBeUndefined();
    expect(normalizeAIGuardAction(undefined)).toBeUndefined();
  });
});

describe("getErrorMessage", () => {
  it("should return message from Error", () => {
    expect(getErrorMessage(new Error("test error"))).toBe("test error");
  });

  it("should return string representation for non-Error", () => {
    expect(getErrorMessage("string error")).toBe("string error");
    expect(getErrorMessage(42)).toBe("42");
  });

  it("should stringify Error with empty message", () => {
    const error = new Error("");
    expect(getErrorMessage(error)).toBe("Error");
  });
});

describe("hasMeaningfulAssistantMessages", () => {
  it("should return true when messages have tool_calls", () => {
    expect(
      hasMeaningfulAssistantMessages([
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "1", function: { name: "test", arguments: "{}" } }],
        },
      ]),
    ).toBe(true);
  });

  it("should return true when messages have non-empty string content", () => {
    expect(hasMeaningfulAssistantMessages([{ role: "assistant", content: "Hello" }])).toBe(true);
  });

  it("should return false when messages have empty string content", () => {
    expect(hasMeaningfulAssistantMessages([{ role: "assistant", content: "" }])).toBe(false);
  });

  it("should return true when messages have non-empty array content", () => {
    expect(
      hasMeaningfulAssistantMessages([
        { role: "assistant", content: [{ type: "text" as const, text: "hello" }] },
      ]),
    ).toBe(true);
  });

  it("should return false when messages have empty array content", () => {
    expect(hasMeaningfulAssistantMessages([{ role: "assistant", content: [] }])).toBe(false);
  });
});

describe("AIGuardEvaluationEngine", () => {
  let evaluator: MockEvaluator;
  let buildAbortError: Mock<(kind: AIGuardKind) => Error>;
  let logger: {
    info: Mock;
    warn: Mock;
    error: Mock;
  };

  beforeEach(() => {
    evaluator = { evaluate: vi.fn() };
    buildAbortError = vi.fn((kind: AIGuardKind) => new AIGuardAbortError(kind));
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  function createEngine(options?: { allowOnFailure?: boolean }) {
    return new AIGuardEvaluationEngine({
      evaluator,
      allowOnFailure: options?.allowOnFailure ?? true,
      logger,
      buildAbortError,
    });
  }

  describe("evaluate", () => {
    it("should return undefined for empty messages without calling evaluator", async () => {
      const engine = createEngine();

      const result = await engine.evaluate([], "Prompt");

      expect(result).toBeUndefined();
      expect(evaluator.evaluate).not.toHaveBeenCalled();
    });

    it("should call evaluator with block: true", async () => {
      evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "", tags: [], sds: [] });
      const engine = createEngine();

      await engine.evaluate([{ role: "user", content: "Hello" }], "Prompt");

      expect(evaluator.evaluate).toHaveBeenCalledWith([{ role: "user", content: "Hello" }], {
        block: true,
      });
    });

    it("should return result on ALLOW", async () => {
      evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "", tags: [], sds: [] });
      const engine = createEngine();

      const result = await engine.evaluate([{ role: "user", content: "Hello" }], "Prompt");

      expect(result).toStrictEqual({ action: "ALLOW", reason: "", tags: [], sds: [] });
    });

    it("should warn on DENY without throwing", async () => {
      evaluator.evaluate.mockResolvedValue({ action: "DENY", reason: "policy", tags: [], sds: [] });
      const engine = createEngine();

      const result = await engine.evaluate([{ role: "user", content: "Hello" }], "Prompt");

      expect(result).toStrictEqual({ action: "DENY", reason: "policy", tags: [], sds: [] });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Datadog returned action=%s without blocking"),
        expect.any(String),
        "DENY",
        expect.any(String),
      );
    });

    it("should throw buildAbortError when evaluator throws AIGuardAbortError", async () => {
      evaluator.evaluate.mockRejectedValue(createSDKAbortError("blocked"));
      const engine = createEngine();

      await expect(
        engine.evaluate([{ role: "user", content: "Hello" }], "Prompt"),
      ).rejects.toBeInstanceOf(AIGuardAbortError);
      expect(buildAbortError).toHaveBeenCalledWith("Prompt");
    });

    it("should return undefined on non-abort error with allowOnFailure=true", async () => {
      evaluator.evaluate.mockRejectedValue(new Error("network error"));
      const engine = createEngine({ allowOnFailure: true });

      const result = await engine.evaluate([{ role: "user", content: "Hello" }], "Prompt");

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should throw AIGuardClientError on non-abort error with allowOnFailure=false", async () => {
      evaluator.evaluate.mockRejectedValue(new Error("network error"));
      const engine = createEngine({ allowOnFailure: false });

      await expect(
        engine.evaluate([{ role: "user", content: "Hello" }], "Prompt"),
      ).rejects.toBeInstanceOf(AIGuardClientError);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("evaluateToolCall", () => {
    it("should return undefined when baseMessages is undefined", async () => {
      const engine = createEngine();

      const result = await engine.evaluateToolCall(
        { toolCallId: "call_1", toolName: "test", input: "{}" },
        undefined,
      );

      expect(result).toBeUndefined();
    });

    it("should convert and evaluate tool call", async () => {
      evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "", tags: [], sds: [] });
      const engine = createEngine();
      const baseMessages = [{ role: "user", content: "Hello" }];

      const result = await engine.evaluateToolCall(
        { toolCallId: "call_1", toolName: "getWeather", input: '{"city":"Tokyo"}' },
        baseMessages,
      );

      expect(result).toStrictEqual({
        id: "call_1",
        function: { name: "getWeather", arguments: '{"city":"Tokyo"}' },
      });
      expect(evaluator.evaluate).toHaveBeenCalledWith(
        [
          { role: "user", content: "Hello" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              { id: "call_1", function: { name: "getWeather", arguments: '{"city":"Tokyo"}' } },
            ],
          },
        ],
        { block: true },
      );
    });

    it("should include preceding tool calls in evaluation", async () => {
      evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "", tags: [], sds: [] });
      const engine = createEngine();
      const baseMessages = [{ role: "user", content: "Hello" }];
      const precedingToolCalls = [
        { id: "call_0", function: { name: "firstTool", arguments: "{}" } },
      ];

      await engine.evaluateToolCall(
        { toolCallId: "call_1", toolName: "secondTool", input: "{}" },
        baseMessages,
        precedingToolCalls,
      );

      const evaluateCall = evaluator.evaluate.mock.calls[0][0];
      const assistantMsg = evaluateCall[1];
      expect(assistantMsg.tool_calls).toHaveLength(2);
      expect(assistantMsg.tool_calls[0].id).toBe("call_0");
      expect(assistantMsg.tool_calls[1].id).toBe("call_1");
    });
  });

  describe("evaluateAssistantResponse", () => {
    it("should return when baseMessages is undefined", async () => {
      const engine = createEngine();

      await engine.evaluateAssistantResponse([{ type: "text", text: "Hello" }], undefined);

      expect(evaluator.evaluate).not.toHaveBeenCalled();
    });

    it("should evaluate text response as Assistant response", async () => {
      evaluator.evaluate.mockResolvedValue({ action: "ALLOW", reason: "", tags: [], sds: [] });
      const engine = createEngine();
      const baseMessages = [{ role: "user", content: "Hello" }];

      await engine.evaluateAssistantResponse([{ type: "text", text: "I am fine" }], baseMessages);

      expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    });

    it("should skip when content is empty", async () => {
      const engine = createEngine();
      const baseMessages = [{ role: "user", content: "Hello" }];

      await engine.evaluateAssistantResponse([], baseMessages);

      expect(evaluator.evaluate).not.toHaveBeenCalled();
    });
  });

  describe("isBlockedByPolicy", () => {
    it("should return true for AIGuardAbortError", () => {
      const engine = createEngine();
      expect(engine.isBlockedByPolicy(new AIGuardAbortError("Prompt"))).toBe(true);
    });

    it("should return true for error with isRetryable=false", () => {
      const engine = createEngine();
      const error = Object.assign(new Error("test"), { isRetryable: false });
      expect(engine.isBlockedByPolicy(error)).toBe(true);
    });

    it("should return false for regular errors", () => {
      const engine = createEngine();
      expect(engine.isBlockedByPolicy(new Error("test"))).toBe(false);
    });
  });

  describe("createStreamErrorForAbort", () => {
    it("should return AIGuardStreamTripWire for blocked policy", () => {
      const engine = createEngine();
      const error = new AIGuardAbortError("Tool call");
      const tripWire = engine.createStreamErrorForAbort(error);

      expect(tripWire).toBeInstanceOf(AIGuardStreamTripWire);
      expect(tripWire.message).toBe("Tool call blocked by AI Guard security policy");
    });

    it("should return AIGuardStreamTripWire for client error", () => {
      const engine = createEngine();
      const error = new AIGuardClientError();
      const tripWire = engine.createStreamErrorForAbort(error);

      expect(tripWire).toBeInstanceOf(AIGuardStreamTripWire);
      expect(tripWire.message).toBe("AI Guard evaluation failed");
    });

    it("should return generic AIGuardStreamTripWire for other errors", () => {
      const engine = createEngine();
      const tripWire = engine.createStreamErrorForAbort(new Error("unknown"));

      expect(tripWire).toBeInstanceOf(AIGuardStreamTripWire);
      expect(tripWire.message).toBe("AI Guard security check failed");
    });
  });
});
