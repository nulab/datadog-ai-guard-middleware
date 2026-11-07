# @nulab/datadog-ai-guard-middleware-ai-v3

## 0.1.2

### Patch Changes

- [#6](https://github.com/nulab/datadog-ai-guard-middleware/pull/6) [`4060b2d`](https://github.com/nulab/datadog-ai-guard-middleware/commit/4060b2d3c49515cc2314bae58fe148e233db8648) Thanks [@vvatanabe](https://github.com/vvatanabe)! - Declare the middleware specification version as v3 so it can be used with AI SDK v6's wrapLanguageModel. Validate the v3 adapter with AI SDK v6 and the v2 adapter with AI SDK v5, including SDK connection type checks and generation, streaming, tool-call, evaluation-failure, and retry behavior.
- Updated dependencies [[`faaea15`](https://github.com/nulab/datadog-ai-guard-middleware/commit/faaea15e6ada4420e6b0601bd0dbb021c6928e09), [`a485e49`](https://github.com/nulab/datadog-ai-guard-middleware/commit/a485e49d99e2586848c17c4b6dd95555d28a2af5)]:
  - @nulab/datadog-ai-guard-middleware-core@0.1.2

## 0.1.1

### Patch Changes

- [`8200e69`](https://github.com/nulab/datadog-ai-guard-middleware/commit/8200e69101c56a792e432fe79420506fb0b6780d) Thanks [@vvatanabe](https://github.com/vvatanabe)! - Skip unnecessary AI Guard API call when prompt or converted messages are empty

- Updated dependencies [[`8200e69`](https://github.com/nulab/datadog-ai-guard-middleware/commit/8200e69101c56a792e432fe79420506fb0b6780d)]:
  - @nulab/datadog-ai-guard-middleware-core@0.1.1

## 0.1.0

### Minor Changes

- Initial release

### Patch Changes

- Updated dependencies []:
  - @nulab/datadog-ai-guard-middleware-core@0.1.0
