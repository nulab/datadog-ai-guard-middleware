import type tracer from "dd-trace";
import type { AIGuardEvaluator, AIGuardMessage, AIGuardMiddlewareOptions } from "../dist/index.js";

export function evaluateWithPublicTypes(
  evaluator: AIGuardEvaluator,
): Promise<tracer.aiguard.Evaluation> {
  const toolCall: tracer.aiguard.ToolCall = {
    id: "call-1",
    function: { name: "getTime", arguments: "{}" },
  };
  const messages: AIGuardMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "Hello" },
        { type: "image_url", image_url: { url: "https://example.com/image.png" } },
      ],
    },
    { role: "assistant", tool_calls: [toolCall] },
    { role: "tool", tool_call_id: "call-1", content: "12:00" },
  ];
  const options: AIGuardMiddlewareOptions = { evaluator, allowOnFailure: false };
  return options.evaluator.evaluate(messages, { block: true });
}
