import { describe, expect, it } from "vitest";
import { AIGuardAbortError, AIGuardClientError, AIGuardStreamTripWire } from "./errors.js";

describe("AIGuardAbortError", () => {
  it("should have correct name and code", () => {
    const error = new AIGuardAbortError("Prompt");
    expect(error.name).toBe("AIGuardAbortError");
    expect(error.code).toBe("AI_GUARD_ABORT");
  });

  it("should store kind", () => {
    const error = new AIGuardAbortError("Tool call");
    expect(error.kind).toBe("Tool call");
  });

  it("should format message from kind", () => {
    const error = new AIGuardAbortError("Assistant response");
    expect(error.message).toBe("Assistant response blocked by AI Guard security policy");
  });

  it("should be an instance of Error", () => {
    const error = new AIGuardAbortError("Prompt");
    expect(error).toBeInstanceOf(Error);
  });

  it("should not expose sensitive fields (security)", () => {
    const error = new AIGuardAbortError("Prompt");
    expect(Object.hasOwn(error, "reason")).toBe(false);
    expect(Object.hasOwn(error, "tags")).toBe(false);
    expect(Object.hasOwn(error, "cause")).toBe(false);
  });

  it("should not leak sensitive field names in JSON serialization", () => {
    const error = new AIGuardAbortError("Prompt");
    const json = JSON.stringify(error);
    expect(json).not.toContain('"reason"');
    expect(json).not.toContain('"tags"');
  });
});

describe("AIGuardClientError", () => {
  it("should have correct name and code", () => {
    const error = new AIGuardClientError();
    expect(error.name).toBe("AIGuardMiddlewareClientError");
    expect(error.code).toBe("AI_GUARD_MIDDLEWARE_CLIENT_ERROR");
  });

  it("should have fixed message", () => {
    const error = new AIGuardClientError();
    expect(error.message).toBe("AI Guard evaluation failed");
  });

  it("should be an instance of Error", () => {
    const error = new AIGuardClientError();
    expect(error).toBeInstanceOf(Error);
  });

  it("should not expose cause (security)", () => {
    const error = new AIGuardClientError();
    expect(Object.hasOwn(error, "cause")).toBe(false);
    expect(error.cause).toBeUndefined();
  });
});

describe("AIGuardStreamTripWire", () => {
  it("should have correct name", () => {
    const error = new AIGuardStreamTripWire("test message");
    expect(error.name).toBe("AIGuardStreamTripWire");
  });

  it("should be an instance of Error", () => {
    const error = new AIGuardStreamTripWire("test");
    expect(error).toBeInstanceOf(Error);
  });

  it("should not expose sensitive fields (security)", () => {
    const error = new AIGuardStreamTripWire("test");
    expect(Object.hasOwn(error, "reason")).toBe(false);
    expect(Object.hasOwn(error, "tags")).toBe(false);
  });
});
