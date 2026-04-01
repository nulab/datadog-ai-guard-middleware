# Datadog AI Guard Middleware

[![CI](https://github.com/nulab/datadog-ai-guard-middleware/actions/workflows/ci.yml/badge.svg)](https://github.com/nulab/datadog-ai-guard-middleware/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

[Vercel AI SDK](https://sdk.vercel.ai/) middleware that evaluates LLM prompts, assistant responses, and tool calls through [Datadog AI Guard](https://docs.datadoghq.com/llm_observability/ai_guard/), blocking requests based on Datadog's security policies.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@nulab/datadog-ai-guard-middleware-ai-v3`](./packages/ai-v3) | [![npm](https://img.shields.io/npm/v/@nulab/datadog-ai-guard-middleware-ai-v3.svg)](https://www.npmjs.com/package/@nulab/datadog-ai-guard-middleware-ai-v3) | AI SDK v6 (`@ai-sdk/provider@^3`) |
| [`@nulab/datadog-ai-guard-middleware-ai-v2`](./packages/ai-v2) | [![npm](https://img.shields.io/npm/v/@nulab/datadog-ai-guard-middleware-ai-v2.svg)](https://www.npmjs.com/package/@nulab/datadog-ai-guard-middleware-ai-v2) | AI SDK v5 (`@ai-sdk/provider@^2`) |
| [`@nulab/datadog-ai-guard-middleware-core`](./packages/core) | [![npm](https://img.shields.io/npm/v/@nulab/datadog-ai-guard-middleware-core.svg)](https://www.npmjs.com/package/@nulab/datadog-ai-guard-middleware-core) | AI SDK-independent core logic |

## Which package should I use?

| Your AI SDK version | Install |
|---------------------|---------|
| AI SDK **v6** (latest, `@ai-sdk/provider@^3`) | `@nulab/datadog-ai-guard-middleware-ai-v3` |
| AI SDK **v5** (`@ai-sdk/provider@^2`) | `@nulab/datadog-ai-guard-middleware-ai-v2` |

> `@nulab/datadog-ai-guard-middleware-core` does not need to be installed directly. It is automatically installed as an internal dependency of the middleware packages.

## Quick Start

### Installation

```bash
npm install @nulab/datadog-ai-guard-middleware-ai-v3
```

### Usage

```ts
import ddtracer from "dd-trace";
import { generateText, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  AIGuardMiddleware,
  AIGuardMiddlewareAbortError,
} from "@nulab/datadog-ai-guard-middleware-ai-v3";

// Initialize dd-trace with AI Guard enabled
ddtracer.init({
  experimental: {
    aiguard: { enabled: true },
  },
});

// Create a guarded model
const guardedModel = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: [new AIGuardMiddleware({ evaluator: ddtracer.aiguard })],
});

// Use it with generateText / streamText
try {
  const { text } = await generateText({
    model: guardedModel,
    prompt: "Hello!",
  });
  console.log(text);
} catch (err) {
  if (err instanceof AIGuardMiddlewareAbortError) {
    console.error("Blocked by AI Guard security policy");
  }
}
```

> For detailed usage including streaming, error handling, and all configuration options, see the package README for [ai-v3](./packages/ai-v3) or [ai-v2](./packages/ai-v2).

## Requirements

- Node.js >= 22
- [dd-trace](https://github.com/DataDog/dd-trace-js) >= 5 with AI Guard enabled (`experimental.aiguard.enabled: true`)
- AI SDK v5 (`@ai-sdk/provider@^2`) or v6 (`@ai-sdk/provider@^3`)

## Contributing

### Prerequisites

- Node.js >= 22
- [pnpm](https://pnpm.io/) (managed via [Corepack](https://nodejs.org/api/corepack.html))

### Setup

```bash
corepack enable
pnpm install
```

### Build

```bash
pnpm -r run build
```

### Test

```bash
pnpm -r run test
```

### Lint & Format

```bash
pnpm run check
```

## License

[Apache-2.0](./LICENSE)
