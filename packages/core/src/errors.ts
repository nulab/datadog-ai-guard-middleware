import type { AIGuardKind } from "./types.js";

export class AIGuardAbortError extends Error {
  override readonly name: string = "AIGuardAbortError";
  readonly code: string = "AI_GUARD_ABORT";
  readonly kind: AIGuardKind;

  constructor(kind: AIGuardKind) {
    super(`${kind} blocked by AI Guard security policy`);
    this.kind = kind;
  }
}

export class AIGuardClientError extends Error {
  override readonly name = "AIGuardMiddlewareClientError";
  readonly code = "AI_GUARD_MIDDLEWARE_CLIENT_ERROR";

  constructor() {
    super("AI Guard evaluation failed");
  }
}

export class AIGuardStreamTripWire extends Error {
  override readonly name = "AIGuardStreamTripWire";
}
