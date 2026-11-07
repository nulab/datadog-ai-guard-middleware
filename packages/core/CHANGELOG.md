# @nulab/datadog-ai-guard-middleware-core

## 0.1.2

### Patch Changes

- [#7](https://github.com/nulab/datadog-ai-guard-middleware/pull/7) [`faaea15`](https://github.com/nulab/datadog-ai-guard-middleware/commit/faaea15e6ada4420e6b0601bd0dbb021c6928e09) Thanks [@vvatanabe](https://github.com/vvatanabe)! - Support dd-trace 6.20.1 and later 6.x releases alongside dd-trace 5.134.0 and later 5.x releases. Preserve the existing AI Guard message types and evaluation behavior. Validate both release lines on Node.js 22 and 24.

- [#4](https://github.com/nulab/datadog-ai-guard-middleware/pull/4) [`a485e49`](https://github.com/nulab/datadog-ai-guard-middleware/commit/a485e49d99e2586848c17c4b6dd95555d28a2af5) Thanks [@vvatanabe](https://github.com/vvatanabe)! - Require dd-trace ^5.134.0 to exclude vulnerable older 5.x releases. Update dd-trace to 5.134.0 and its transitive dependencies in the workspace lockfile, resolving the production dependency audit findings without overrides.
  
  Consumers using dd-trace below 5.134.0 must upgrade within the 5.x release line.

## 0.1.1

### Patch Changes

- [`8200e69`](https://github.com/nulab/datadog-ai-guard-middleware/commit/8200e69101c56a792e432fe79420506fb0b6780d) Thanks [@vvatanabe](https://github.com/vvatanabe)! - Skip unnecessary AI Guard API call when prompt or converted messages are empty

## 0.1.0

### Minor Changes

- Initial release
