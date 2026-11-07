import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AIGuardAbortError, AIGuardClientError, AIGuardEvaluationEngine } from "./index.js";
import type { AIGuardEvaluator, AIGuardMessage } from "./types.js";

const sensitiveReason = "private-policy-details";
const messages: AIGuardMessage[] = [{ role: "user", content: [{ type: "text", text: "Hello" }] }];
let status = 200;
let action = "ALLOW";
let blocking = false;
let received: unknown;
let evaluator: AIGuardEvaluator;

const server = createServer(async (request, response) => {
  if (request.url !== "/evaluate") {
    response.end("{}");
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  received = JSON.parse(body);
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      data: { attributes: { action, reason: sensitiveReason, is_blocking_enabled: blocking } },
    }),
  );
});

function engine(allowOnFailure = false) {
  return new AIGuardEvaluationEngine({
    evaluator,
    allowOnFailure,
    logger: { info() {}, warn() {}, error() {} },
    buildAbortError: (kind) => new AIGuardAbortError(kind),
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  const endpoint = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("DD_TRACE_ENABLED", "true");
  vi.stubEnv("DD_API_KEY", "local-test-key");
  vi.stubEnv("DD_APP_KEY", "local-test-key");
  vi.stubEnv("DD_INSTRUMENTATION_TELEMETRY_ENABLED", "false");
  vi.stubEnv("DD_REMOTE_CONFIGURATION_ENABLED", "false");
  const tracer = (await import("dd-trace")).default;
  tracer.init({
    plugins: false,
    startupLogs: false,
    url: endpoint,
    profiling: false,
    runtimeMetrics: false,
    appsec: { enabled: false },
    experimental: { aiguard: { enabled: true, endpoint, timeout: 1000 } },
  });
  // The public core message type is wider than dd-trace's discriminated union.
  evaluator = tracer.aiguard as AIGuardEvaluator;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  vi.unstubAllEnvs();
});

beforeEach(() => {
  status = 200;
  action = "ALLOW";
  blocking = false;
  received = undefined;
});

describe("installed dd-trace AI Guard against a local service", () => {
  it("passes structured messages through the real SDK", async () => {
    const result = await engine().evaluate(messages, "Prompt");
    expect(result?.action).toBe("ALLOW");
    expect(received).toMatchObject({ data: { attributes: { messages } } });
  });

  it("preserves monitor-only DENY behavior", async () => {
    action = "DENY";
    const result = await engine().evaluate(messages, "Prompt");
    expect(result?.action).toBe("DENY");
  });

  it.each(["DENY", "ABORT"])(
    "enforces a blocking %s without exposing the service reason",
    async (decision) => {
      action = decision;
      blocking = true;
      const result = engine().evaluate(messages, "Prompt");
      await expect(result).rejects.toBeInstanceOf(AIGuardAbortError);
      await expect(result).rejects.toMatchObject({
        message: "Prompt blocked by AI Guard security policy",
      });
      await expect(result).rejects.not.toHaveProperty("reason");
    },
  );

  it.each([true, false])(
    "honors allowOnFailure=%s for an SDK HTTP error",
    async (allowOnFailure) => {
      status = 503;
      const result = engine(allowOnFailure).evaluate(messages, "Prompt");
      if (allowOnFailure) await expect(result).resolves.toBeUndefined();
      else await expect(result).rejects.toBeInstanceOf(AIGuardClientError);
    },
  );
});
