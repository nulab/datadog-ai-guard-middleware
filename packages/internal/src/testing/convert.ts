import { describe, expect, it } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ConvertTestDeps {
  convertToAIGuardFormat: (prompt: any) => any;
  castPrompt: (messages: Array<{ role: string; content: unknown }>) => any;
}

export function defineConvertTests(deps: ConvertTestDeps): void {
  const { convertToAIGuardFormat, castPrompt } = deps;

  describe("AI Guard Middleware Convert", () => {
    describe("convertToAIGuardFormat", () => {
      it("should convert system message", () => {
        const prompt = [{ role: "system", content: "You are a helpful assistant" }];

        const result = convertToAIGuardFormat(castPrompt(prompt));

        expect(result).toStrictEqual([{ role: "system", content: "You are a helpful assistant" }]);
      });

      it("should convert user message with string content", () => {
        const prompt = [{ role: "user", content: "Hello!" }];

        const result = convertToAIGuardFormat(castPrompt(prompt));

        expect(result).toStrictEqual([{ role: "user", content: "Hello!" }]);
      });

      it("should convert user message with array content", () => {
        const prompt = [
          {
            role: "user",
            content: [
              { type: "text", text: "Hello, " },
              { type: "text", text: "how are you?" },
            ],
          },
        ];

        const result = convertToAIGuardFormat(castPrompt(prompt));

        expect(result).toStrictEqual([{ role: "user", content: "Hello, how are you?" }]);
      });

      it("should convert assistant message with text content", () => {
        const prompt = [
          {
            role: "assistant",
            content: [{ type: "text", text: "I am fine, thank you!" }],
          },
        ];

        const result = convertToAIGuardFormat(castPrompt(prompt));

        expect(result).toStrictEqual([{ role: "assistant", content: "I am fine, thank you!" }]);
      });

      it("should convert assistant message with tool calls", () => {
        const prompt = [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "getWeather",
                args: { city: "Tokyo" },
              },
            ],
          },
        ];

        const result = convertToAIGuardFormat(castPrompt(prompt));

        expect(result).toStrictEqual([
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "getWeather",
                  arguments: '{"city":"Tokyo"}',
                },
              },
            ],
          },
        ]);
      });

      it("should convert tool result messages", () => {
        const prompt = [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call_1",
                output: { type: "json", value: { temperature: 20, condition: "sunny" } },
              },
            ],
          },
        ];

        const result = convertToAIGuardFormat(castPrompt(prompt));

        expect(result).toStrictEqual([
          {
            role: "tool",
            tool_call_id: "call_1",
            content: '{"temperature":20,"condition":"sunny"}',
          },
        ]);
      });

      it("should convert multiple tool results into separate messages", () => {
        const prompt = [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call_1",
                output: { type: "text", value: "Weather is sunny" },
              },
              {
                type: "tool-result",
                toolCallId: "call_2",
                output: { type: "text", value: "Time is 3:00 PM" },
              },
            ],
          },
        ];

        const result = convertToAIGuardFormat(castPrompt(prompt));

        expect(result).toStrictEqual([
          { role: "tool", tool_call_id: "call_1", content: "Weather is sunny" },
          { role: "tool", tool_call_id: "call_2", content: "Time is 3:00 PM" },
        ]);
      });

      it.each([
        { desc: "undefined", toolCallId: undefined },
        { desc: "empty string", toolCallId: "" },
        { desc: "whitespace only", toolCallId: "   " },
        { desc: "number", toolCallId: 123 },
        { desc: "null", toolCallId: null },
      ])("should throw when tool result toolCallId is $desc", ({ toolCallId }) => {
        const prompt = [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId,
                output: { type: "text", value: "some result" },
              },
            ],
          },
        ];

        expect(() => convertToAIGuardFormat(castPrompt(prompt))).toThrow(
          "Tool result must have a non-empty tool_call_id",
        );
      });

      it("should convert full conversation", () => {
        const prompt = [
          { role: "system", content: "You are a helpful assistant" },
          { role: "user", content: "What is the weather in Tokyo?" },
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "getWeather",
                args: { city: "Tokyo" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call_1",
                output: { type: "json", value: { temperature: 20, condition: "sunny" } },
              },
            ],
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "The weather in Tokyo is sunny with 20°C." }],
          },
        ];

        const result = convertToAIGuardFormat(castPrompt(prompt));

        expect(result).toStrictEqual([
          { role: "system", content: "You are a helpful assistant" },
          { role: "user", content: "What is the weather in Tokyo?" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "getWeather",
                  arguments: '{"city":"Tokyo"}',
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_1",
            content: '{"temperature":20,"condition":"sunny"}',
          },
          { role: "assistant", content: "The weather in Tokyo is sunny with 20°C." },
        ]);
      });

      it("should handle assistant message with non-array content", () => {
        const prompt = [{ role: "assistant", content: "Simple text response" }];

        const result = convertToAIGuardFormat(castPrompt(prompt));

        expect(result).toStrictEqual([{ role: "assistant", content: "Simple text response" }]);
      });

      it("should handle empty prompt", () => {
        const result = convertToAIGuardFormat([]);
        expect(result).toStrictEqual([]);
      });

      it("should convert full V2 conversation with output field", () => {
        const prompt = [
          { role: "system", content: "You are a helpful assistant" },
          { role: "user", content: "What is the weather in Tokyo?" },
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "getWeather",
                input: { city: "Tokyo" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call_1",
                toolName: "getWeather",
                output: { type: "json", value: { temperature: 20, condition: "sunny" } },
              },
            ],
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "The weather in Tokyo is sunny with 20°C." }],
          },
        ];

        const result = convertToAIGuardFormat(castPrompt(prompt));

        expect(result).toStrictEqual([
          { role: "system", content: "You are a helpful assistant" },
          { role: "user", content: "What is the weather in Tokyo?" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "getWeather",
                  arguments: '{"city":"Tokyo"}',
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_1",
            content: '{"temperature":20,"condition":"sunny"}',
          },
          { role: "assistant", content: "The weather in Tokyo is sunny with 20°C." },
        ]);
      });
    });
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */
