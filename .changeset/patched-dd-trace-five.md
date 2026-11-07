---
"@nulab/datadog-ai-guard-middleware-core": patch
---

Require dd-trace ^5.134.0 to exclude vulnerable older 5.x releases. Update dd-trace to 5.134.0 and its transitive dependencies in the workspace lockfile, resolving the production dependency audit findings without overrides.

Consumers using dd-trace below 5.134.0 must upgrade within the 5.x release line.
