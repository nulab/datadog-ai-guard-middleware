import type tracer from "dd-trace";

// --- Multimodal content types (kept: dd-trace-js Message does not support content parts) ---

export interface AIGuardTextContentPart {
  type: "text";
  text: string;
}

export interface AIGuardImageUrlContentPart {
  type: "image_url";
  image_url: {
    url: string;
  };
}

export type AIGuardContentPart = AIGuardTextContentPart | AIGuardImageUrlContentPart;

// --- AIGuardMessage (kept: dd-trace-js Message lacks multimodal support) ---

export type AIGuardMessage = {
  role: string;
  content?: string | AIGuardContentPart[];
  tool_calls?: tracer.aiguard.ToolCall[];
  tool_call_id?: string;
};

// --- AIGuardEvaluator (kept: accepts AIGuardMessage[] which is wider than dd-trace Message[]) ---

export interface AIGuardEvaluator {
  evaluate(
    messages: AIGuardMessage[],
    opts?: { block?: boolean },
  ): Promise<tracer.aiguard.Evaluation>;
}

// --- Middleware-specific types ---

export type AIGuardKind = "Prompt" | "Assistant response" | "Tool call";

export interface AIGuardLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface AIGuardMiddlewareOptions {
  evaluator: AIGuardEvaluator;
  allowOnFailure?: boolean;
  createAbortError?: (kind: AIGuardKind, message: string) => Error;
  logger?: AIGuardLogger;
}

// --- Vercel AI SDK conversion types ---

export interface ToolCallPartInput {
  type?: string;
  toolCallId?: string;
  id?: string;
  toolName?: string;
  name?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  input?: unknown;
  args?: unknown;
  arguments?: unknown;
}

export interface CoreContentPart {
  type: string;
  text?: string;
  mediaType?: unknown;
  data?: unknown;
}
