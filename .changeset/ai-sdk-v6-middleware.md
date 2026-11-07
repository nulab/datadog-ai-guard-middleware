---
"@nulab/datadog-ai-guard-middleware-ai-v3": patch
---

Declare the middleware specification version as v3 so it can be used with AI SDK v6's wrapLanguageModel. Validate the v3 adapter with AI SDK v6 and the v2 adapter with AI SDK v5, including SDK connection type checks and generation, streaming, tool-call, evaluation-failure, and retry behavior.
