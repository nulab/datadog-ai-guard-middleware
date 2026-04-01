# @nulab/datadog-ai-guard-middleware-ai-v3

Datadog AI Guard middleware for [Vercel AI SDK](https://sdk.vercel.ai/) v6 (`@ai-sdk/provider@^3`).

> Using AI SDK v5? See [`@nulab/datadog-ai-guard-middleware-ai-v2`](https://www.npmjs.com/package/@nulab/datadog-ai-guard-middleware-ai-v2) instead.

## Installation

```bash
npm install @nulab/datadog-ai-guard-middleware-ai-v3
```

### Peer Dependencies

- `@ai-sdk/provider` ^3.0.0

## Usage

### Initializing dd-trace

Initialize dd-trace with AI Guard enabled and pass `ddtracer.aiguard` (the `AIGuardEvaluator`) to the middleware.

```ts
import ddtracer from "dd-trace";

ddtracer.init({
  experimental: {
    aiguard: { enabled: true },
  },
});
```

> Authentication follows **dd-trace environment variables** (`DD_API_KEY`, `DD_APP_KEY`, etc.). The AI Guard endpoint is **resolved by dd-trace from `DD_SITE`** (e.g., `ap1.datadoghq.com` -> `https://app.ap1.datadoghq.com/api/v2/ai-guard`).

### Creating a Guarded Model

Use `wrapLanguageModel` to create a middleware-applied model that can be reused with both `generateText` and `streamText`.

```ts
import { wrapLanguageModel } from "ai";

const guardedModel = wrapLanguageModel({
  model: yourModel,
  middleware: [
    new AIGuardMiddleware({
      evaluator: ddtracer.aiguard,
    }),
  ],
});
```

### Non-Streaming

```ts
import { generateText } from "ai";
import {
  AIGuardMiddleware,
  AIGuardMiddlewareAbortError,
} from "@nulab/datadog-ai-guard-middleware-ai-v3";

try {
  const result = await generateText({
    model: guardedModel,
    prompt: "Hello",
  });
  console.log(result.text);
} catch (err) {
  if (err instanceof AIGuardMiddlewareAbortError) {
    // Blocked by AI Guard security policy
  } else {
    throw err;
  }
}
```

- The prompt is evaluated **before** being sent to the LLM. If Datadog's **blocking policy** is active and the prompt violates it, an `AIGuardMiddlewareAbortError` is thrown.
- After the LLM responds, the **entire assistant turn** is evaluated once. If Datadog returns `DENY` / `ABORT` without a blocking policy, only a **warning** is logged.

### Streaming

```ts
import { streamText } from "ai";

const { stream } = await streamText({
  model: guardedModel,
  prompt: "Hello",
});

for await (const part of stream) {
  if (part.type === "text-delta") process.stdout.write(part.text);
  if (part.type === "error") {
    // AIGuardStreamTripWire error: tool call blocked by AI Guard
    console.error("blocked:", String(part.error?.message));
  }
}
```

- In streaming mode, **text-only assistant output is not sent to AI Guard**. AI Guard evaluates only prompts and `tool-call` chunks.
- When evaluating a `tool-call`, **preceding sibling tool calls from the same turn** are included in the same evaluation request.

## Options

```ts
interface AIGuardMiddlewareOptions {
  evaluator: AIGuardEvaluator;
  allowOnFailure?: boolean;
  createAbortError?: (kind: AIGuardKind, message: string) => Error;
  logger?: AIGuardLogger;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `evaluator` | `AIGuardEvaluator` | (required) | Object with an `evaluate(messages, opts)` method. Pass `ddtracer.aiguard` when using dd-trace. Any object satisfying the `AIGuardEvaluator` interface works. |
| `allowOnFailure` | `boolean` | `true` | `true`: fail-open (continue on evaluation errors). `false`: throw `AIGuardMiddlewareClientError` when evaluation is unavailable. Covers both API failures and message normalization/conversion errors. |
| `createAbortError` | `(kind, message) => Error` | — | Factory to create a custom error when AI Guard blocks a request. `markAsNonRetryable()` is automatically applied. Useful for framework integration (e.g., injecting Mastra's `TripWire`). |
| `logger` | `AIGuardLogger` | `console` | Logger with `info`, `warn`, `error` methods. Defaults to `console` so security events are always visible. Pass a no-op logger (`{ info() {}, warn() {}, error() {} }`) to suppress output. |

> When Datadog returns `DENY` / `ABORT` without a blocking policy, the middleware logs a **warning** and continues regardless of `allowOnFailure`.

## API

### Classes

| Export | Description |
|--------|-------------|
| `AIGuardMiddleware` | Main middleware class. Pass to `wrapLanguageModel` for use. |
| `AIGuardMiddlewareAbortError` | Thrown when Datadog AI Guard's blocking policy blocks a request (default when `createAbortError` is not specified). Use `instanceof` to identify policy blocks. |
| `AIGuardMiddlewareClientError` | Thrown when AI Guard evaluation cannot be performed (`allowOnFailure: false`). Distinguishes service failures from policy blocks (`AIGuardMiddlewareAbortError`). |
| `AIGuardStreamTripWire` | Error used in streaming error chunks (`{ type: "error" }`). Identifies AI Guard-specific errors on the stream consumer side. |

### Types

| Export | Description |
|--------|-------------|
| `AIGuardMiddlewareOptions` | Constructor argument type for `AIGuardMiddleware`. |
| `AIGuardEvaluator` | Interface with an `evaluate(messages, opts)` method. `ddtracer.aiguard` satisfies this interface. |
| `AIGuardLogger` | Interface with `info`, `warn`, `error` methods. |
| `AIGuardKind` | `"Prompt" \| "Assistant response" \| "Tool call"` union type. |
| `AIGuardMessage` | Message type sent to AI Guard. Argument type for `AIGuardEvaluator.evaluate()`. |

### Error Classes

| Class | Code | Condition |
|-------|------|-----------|
| `AIGuardMiddlewareAbortError` | `AI_GUARD_MIDDLEWARE_ABORT` | Datadog AI Guard blocked the request via blocking policy |
| `AIGuardMiddlewareClientError` | `AI_GUARD_MIDDLEWARE_CLIENT_ERROR` | AI Guard evaluation unavailable + `allowOnFailure=false` |
| `AIGuardStreamTripWire` | — | Streaming error chunk: policy block or fail-close evaluation failure |

> **Security**: These errors intentionally hide details from the original AI Guard SDK error (`reason`, `tags`, etc.).

## Evaluation Scope

- **Prompt**: Evaluated once before sending to the LLM
- **Assistant response (non-streaming)**: Evaluated once per assistant turn after `doGenerate`
- **Tool calls (streaming)**: Evaluated on each `tool-call` chunk with accumulated sibling tool calls
- **Tool execution results**: Automatically evaluated as part of the next turn's prompt in agent loops

> Blocking decisions are made by **Datadog AI Guard's blocking policy**. The middleware sends `block: true` but only blocks when Datadog returns `AIGuardAbortError`.

## Known Limitations

- **dd-trace AI Guard experimental feature** must be enabled (use a compatible version).
- **Blocking requires a Datadog-side blocking policy**. Without one, `DENY` / `ABORT` only produces warnings.
- Streaming **text-only output is not protected by AI Guard**. Use non-streaming for strict blocking of all assistant output.
- **Multimodal evaluation supports images (`image/*`) only**. Non-image files (e.g., PDF) are not sent to AI Guard.
- Evaluation API calls increase **per assistant turn (non-streaming)** or **per `tool-call` chunk (streaming)**.

## Requirements

- Node.js >= 22
- `@ai-sdk/provider` ^3.0.0
- [dd-trace](https://github.com/DataDog/dd-trace-js) >= 5 with AI Guard enabled

## License

[Apache-2.0](https://github.com/nulab/datadog-ai-guard-middleware/blob/main/LICENSE)
