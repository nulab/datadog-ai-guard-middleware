# @nulab/datadog-ai-guard-middleware-ai-v4

## 0.1.0

### Minor Changes

- [#10](https://github.com/nulab/datadog-ai-guard-middleware/pull/10) [`0800cbe`](https://github.com/nulab/datadog-ai-guard-middleware/commit/0800cbedc9c622f72e904033c62362be60271d73) Thanks [@vvatanabe](https://github.com/vvatanabe)! - Add an AI SDK v7 adapter for LanguageModelV4 with the same evaluation scope as the existing adapters. Normalize V4 image data for prompt and non-streaming response evaluation, preserve tool-call blocking and retry behavior, and retain the existing exclusions for tool-result images, non-image files, and reasoning content.
