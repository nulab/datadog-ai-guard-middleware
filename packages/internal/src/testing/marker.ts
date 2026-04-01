import { AIGuardAbortError } from "@nulab/datadog-ai-guard-middleware-core";
import { describe, expect, it } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MarkerTestDeps {
  AIGuardMiddlewareAbortError: new (...args: any[]) => any;
  markAsNonRetryable: (error: Error) => void;
}

export function defineMarkerTests(deps: MarkerTestDeps): void {
  const { AIGuardMiddlewareAbortError, markAsNonRetryable } = deps;

  describe("AIGuardMiddlewareAbortError - non-retryable behavior", () => {
    it("should be an instance of Error (not framework-specific)", () => {
      const error = new AIGuardMiddlewareAbortError("Prompt");
      expect(error).toBeInstanceOf(Error);
    });

    it("should be an instance of AIGuardAbortError (core base class)", () => {
      const error = new AIGuardMiddlewareAbortError("Prompt");
      expect(error).toBeInstanceOf(AIGuardAbortError);
    });

    it("should have isRetryable=false for AI SDK retry bypass", () => {
      const error = new AIGuardMiddlewareAbortError("Prompt");
      expect(error.isRetryable).toBe(false);
    });

    it("should carry Vercel AI SDK APICallError markers for shouldRetry detection", () => {
      const error = new AIGuardMiddlewareAbortError("Prompt");
      const sdkMarker = Symbol.for("vercel.ai.error.AI_SDKError");
      const apiCallMarker = Symbol.for("vercel.ai.error.AI_APICallError");
      expect((error as unknown as Record<symbol, unknown>)[sdkMarker]).toBe(true);
      expect((error as unknown as Record<symbol, unknown>)[apiCallMarker]).toBe(true);
    });

    it("should preserve name and code for downstream error handling", () => {
      const error = new AIGuardMiddlewareAbortError("Tool call");
      expect(error.name).toBe("AIGuardMiddlewareAbortError");
      expect(error.code).toBe("AI_GUARD_MIDDLEWARE_ABORT");
      expect(error.kind).toBe("Tool call");
    });

    it("marker symbols should not leak into JSON serialization", () => {
      const error = new AIGuardMiddlewareAbortError("Prompt");
      const json = JSON.stringify(error);
      expect(json).not.toContain("AI_SDKError");
      expect(json).not.toContain("AI_APICallError");
    });
  });

  describe("markAsNonRetryable", () => {
    it("should add AI SDK error markers to a plain Error", () => {
      const error = new Error("test");
      markAsNonRetryable(error);
      const sdkMarker = Symbol.for("vercel.ai.error.AI_SDKError");
      const apiCallMarker = Symbol.for("vercel.ai.error.AI_APICallError");
      expect((error as unknown as Record<symbol, unknown>)[sdkMarker]).toBe(true);
      expect((error as unknown as Record<symbol, unknown>)[apiCallMarker]).toBe(true);
      expect((error as unknown as Record<string, unknown>).isRetryable).toBe(false);
    });

    it("should overwrite existing isRetryable property to false", () => {
      const error = Object.assign(new Error("test"), { isRetryable: true });
      markAsNonRetryable(error);
      expect((error as unknown as Record<string, unknown>).isRetryable).toBe(false);
    });

    it("markers and isRetryable should not appear in JSON serialization", () => {
      const error = new Error("test");
      markAsNonRetryable(error);
      const json = JSON.stringify(error);
      expect(json).not.toContain("AI_SDKError");
      expect(json).not.toContain("AI_APICallError");
      expect(json).not.toContain("isRetryable");
    });
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */
