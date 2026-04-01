import { describe, expect, it } from "vitest";
import {
  convertAssistantContentToAIGuardMessages,
  convertPromptContent,
  convertToolCallPart,
  extractToolResultContent,
} from "./convert.js";
import type { ToolCallPartInput } from "./types.js";

describe("AI Guard Core Convert", () => {
  describe("convertToolCallPart", () => {
    // Basic conversion tests
    it("should convert tool call part with input as object (LanguageModelV3ToolCallPart in prompt)", () => {
      const toolCallPart: ToolCallPartInput = {
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "getWeather",
        input: { city: "Tokyo" },
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_123",
        function: {
          name: "getWeather",
          arguments: '{"city":"Tokyo"}',
        },
      });
    });

    it("should convert tool call part with input as string (LanguageModelV3ToolCall in result/stream)", () => {
      const toolCallPart: ToolCallPartInput = {
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "getWeather",
        input: '{"city":"Tokyo"}',
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_123",
        function: {
          name: "getWeather",
          arguments: '{"city":"Tokyo"}',
        },
      });
    });

    it("should normalize broken JSON when input is string", () => {
      const toolCallPart: ToolCallPartInput = {
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "getWeather",
        input: '{"city":}',
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_123",
        function: {
          name: "getWeather",
          arguments: '{"_raw":"{\\"city\\":}"}',
        },
      });
    });

    it("should return {} when input is empty string", () => {
      const toolCallPart: ToolCallPartInput = {
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "getWeather",
        input: "",
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_123",
        function: {
          name: "getWeather",
          arguments: "{}",
        },
      });
    });

    it("should convert tool call part with args object (legacy format)", () => {
      const toolCallPart: ToolCallPartInput = {
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "getWeather",
        args: { city: "Tokyo" },
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_123",
        function: {
          name: "getWeather",
          arguments: '{"city":"Tokyo"}',
        },
      });
    });

    it("should preserve string arguments (args as valid JSON string)", () => {
      const toolCallPart: ToolCallPartInput = {
        type: "tool-call",
        toolCallId: "call_456",
        toolName: "search",
        args: '{"query":"hello"}',
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_456",
        function: {
          name: "search",
          arguments: '{"query":"hello"}',
        },
      });
    });

    it("should convert function.arguments format (OpenAI compatible)", () => {
      const toolCallPart: ToolCallPartInput = {
        id: "call_789",
        function: {
          name: "test",
          arguments: '{"foo":"bar"}',
        },
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_789",
        function: {
          name: "test",
          arguments: '{"foo":"bar"}',
        },
      });
    });

    it("should convert top-level arguments field", () => {
      const toolCallPart: ToolCallPartInput = {
        toolCallId: "call_1",
        toolName: "test",
        arguments: '{"foo":"bar"}',
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_1",
        function: {
          name: "test",
          arguments: '{"foo":"bar"}',
        },
      });
    });

    it("should return {} when all argument fields are undefined", () => {
      const toolCallPart: ToolCallPartInput = {
        toolCallId: "call_1",
        toolName: "test",
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_1",
        function: {
          name: "test",
          arguments: "{}",
        },
      });
    });

    // Empty/null argument edge cases - consolidated to representative cases
    const emptyArgsCases = [{ desc: "input is empty object", field: "input" as const, value: {} }];

    for (const { desc, field, value } of emptyArgsCases) {
      it(`should return {} when ${desc}`, () => {
        const toolCallPart: ToolCallPartInput = {
          toolCallId: "call_1",
          toolName: "test",
          [field]: value,
        };

        const result = convertToolCallPart(toolCallPart);

        expect(result).toStrictEqual({
          id: "call_1",
          function: {
            name: "test",
            arguments: "{}",
          },
        });
      });
    }

    it("should preserve null when args is null", () => {
      const toolCallPart: ToolCallPartInput = {
        toolCallId: "call_1",
        toolName: "test",
        args: null,
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_1",
        function: {
          name: "test",
          arguments: "null",
        },
      });
    });

    // JSON validity tests
    it("should wrap broken JSON string with _raw", () => {
      const toolCallPart: ToolCallPartInput = {
        toolCallId: "call_1",
        toolName: "test",
        args: '{"foo":}',
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_1",
        function: {
          name: "test",
          arguments: '{"_raw":"{\\"foo\\":}"}',
        },
      });
    });

    // Valid non-object JSON should be preserved so AI Guard sees the original arguments.
    const jsonPrimitiveCases = [
      { desc: "JSON null", value: "null", expected: "null" },
      { desc: "JSON array", value: "[1,2,3]", expected: "[1,2,3]" },
      { desc: "JSON number", value: "123", expected: "123" },
      { desc: "JSON boolean", value: "true", expected: "true" },
    ];

    for (const { desc, value, expected } of jsonPrimitiveCases) {
      it(`should preserve args when it is ${desc}`, () => {
        const toolCallPart: ToolCallPartInput = {
          toolCallId: "call_1",
          toolName: "test",
          args: value,
        };

        const result = convertToolCallPart(toolCallPart);

        expect(result).toStrictEqual({
          id: "call_1",
          function: {
            name: "test",
            arguments: expected,
          },
        });
      });
    }

    // Priority tests
    it("should prioritize input over args", () => {
      const toolCallPart: ToolCallPartInput = {
        toolCallId: "call_1",
        toolName: "test",
        input: { a: 1 },
        args: { b: 2 },
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_1",
        function: {
          name: "test",
          arguments: '{"a":1}',
        },
      });
    });

    it("should prioritize args over function.arguments", () => {
      const toolCallPart: ToolCallPartInput = {
        id: "call_1",
        args: { a: 1 },
        function: {
          name: "test",
          arguments: '{"b":2}',
        },
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_1",
        function: {
          name: "test",
          arguments: '{"a":1}',
        },
      });
    });

    it("should prioritize empty input object over args", () => {
      const toolCallPart: ToolCallPartInput = {
        toolCallId: "call_1",
        toolName: "test",
        input: {},
        args: { b: 2 },
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_1",
        function: {
          name: "test",
          arguments: "{}",
        },
      });
    });

    it("should prioritize explicit null input over args", () => {
      const toolCallPart: ToolCallPartInput = {
        toolCallId: "call_1",
        toolName: "test",
        input: null,
        args: { b: 2 },
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result).toStrictEqual({
        id: "call_1",
        function: {
          name: "test",
          arguments: "null",
        },
      });
    });

    // ID field tests
    it("should prioritize toolCallId over id", () => {
      const toolCallPart: ToolCallPartInput = {
        toolCallId: "tc1",
        id: "id1",
        toolName: "test",
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result.id).toBe("tc1");
    });

    it("should fallback to id when toolCallId is not present", () => {
      const toolCallPart: ToolCallPartInput = {
        id: "id1",
        toolName: "test",
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result.id).toBe("id1");
    });

    // ID validation - parameterized
    const invalidIdCases = [
      { desc: "missing", input: { toolName: "test" } },
      { desc: "empty string", input: { toolCallId: "", toolName: "test" } },
      { desc: "whitespace only", input: { toolCallId: "   ", toolName: "test" } },
      { desc: "number", input: { toolCallId: 123, toolName: "test" } },
    ];

    for (const { desc, input } of invalidIdCases) {
      it(`should throw TypeError when id is ${desc}`, () => {
        expect(() => convertToolCallPart(input as ToolCallPartInput)).toThrow(
          "Tool call ID must be a non-empty string",
        );
      });
    }

    // Name field tests
    it("should prioritize toolName over function.name", () => {
      const toolCallPart: ToolCallPartInput = {
        toolCallId: "call_1",
        toolName: "tn",
        function: { name: "fn" },
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result.function.name).toBe("tn");
    });

    it("should fallback to function.name when toolName is not present", () => {
      const toolCallPart: ToolCallPartInput = {
        id: "call_1",
        function: { name: "fn" },
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result.function.name).toBe("fn");
    });

    it("should fallback to name when toolName and function.name are not present", () => {
      const toolCallPart: ToolCallPartInput = {
        id: "call_1",
        name: "n",
      };

      const result = convertToolCallPart(toolCallPart);

      expect(result.function.name).toBe("n");
    });

    // Name validation - parameterized
    const invalidNameCases = [
      { desc: "missing", input: { toolCallId: "call_1" } },
      { desc: "empty string", input: { toolCallId: "call_1", toolName: "" } },
      { desc: "whitespace only", input: { toolCallId: "call_1", toolName: "   " } },
      { desc: "number", input: { toolCallId: "call_1", toolName: 123 } },
    ];

    for (const { desc, input } of invalidNameCases) {
      it(`should throw TypeError when name is ${desc}`, () => {
        expect(() => convertToolCallPart(input as ToolCallPartInput)).toThrow(
          "Tool call name must be a non-empty string",
        );
      });
    }
  });

  describe("convertPromptContent", () => {
    it("should return string content as-is", () => {
      expect(convertPromptContent("Hello!")).toBe("Hello!");
    });

    it("should join text parts into a single string when no images are present", () => {
      const content = [
        { type: "text", text: "Hello, " },
        { type: "text", text: "how are you?" },
      ];

      expect(convertPromptContent(content)).toBe("Hello, how are you?");
    });

    it("should convert image file URL strings to image_url content parts", () => {
      const content = [
        { type: "text", text: "What is in this image?" },
        { type: "file", mediaType: "image/png", data: "https://example.com/cat.png" },
      ];

      expect(convertPromptContent(content)).toStrictEqual([
        { type: "text", text: "What is in this image?" },
        { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
      ]);
    });

    it("should keep data URLs for image file parts", () => {
      const content = [
        { type: "file", mediaType: "image/jpeg", data: "data:image/jpeg;base64,QUJD" },
      ];

      expect(convertPromptContent(content)).toStrictEqual([
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
      ]);
    });

    it("should convert base64 image file data strings to data URLs", () => {
      const content = [{ type: "file", mediaType: "image/png", data: "QUJD" }];

      expect(convertPromptContent(content)).toStrictEqual([
        { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
      ]);
    });

    it("should convert image file URL objects to image_url content parts", () => {
      const content = [
        {
          type: "file",
          mediaType: "image/webp",
          data: new URL("https://example.com/diagram.webp"),
        },
      ];

      expect(convertPromptContent(content)).toStrictEqual([
        { type: "image_url", image_url: { url: "https://example.com/diagram.webp" } },
      ]);
    });

    it("should convert image file Uint8Array data to data URLs", () => {
      const content = [{ type: "file", mediaType: "image/png", data: Uint8Array.from([1, 2, 3]) }];

      expect(convertPromptContent(content)).toStrictEqual([
        { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
      ]);
    });

    it("should return AIGuardContentPart[] when text and image are mixed", () => {
      const content = [
        { type: "text", text: "Look at this:" },
        { type: "file", mediaType: "image/png", data: "https://example.com/img.png" },
      ];

      expect(convertPromptContent(content)).toStrictEqual([
        { type: "text", text: "Look at this:" },
        { type: "image_url", image_url: { url: "https://example.com/img.png" } },
      ]);
    });

    it("should skip non-image file parts", () => {
      const content = [
        { type: "text", text: "Summarize this document." },
        { type: "file", mediaType: "application/pdf", data: "https://example.com/spec.pdf" },
      ];

      expect(convertPromptContent(content)).toBe("Summarize this document.");
    });

    it("should skip non-text parts and join remaining text", () => {
      const content = [
        { type: "text", text: "Hello" },
        { type: "image", image: "base64..." },
        { type: "text", text: " world" },
      ];

      expect(convertPromptContent(content)).toBe("Hello world");
    });

    it("should return empty string for empty array", () => {
      expect(convertPromptContent([])).toBe("");
    });

    it("should skip text parts without text property", () => {
      const content = [{ type: "text" }, { type: "text", text: "Hello" }];

      expect(convertPromptContent(content)).toBe("Hello");
    });

    it.each([
      null,
      undefined,
      123,
    ])("should return empty string for non-array non-string input: %s", (input) => {
      expect(convertPromptContent(input)).toBe("");
    });
  });

  describe("convertAssistantContentToAIGuardMessages", () => {
    it("should convert text-only content to a single assistant message", () => {
      const content = [{ type: "text", text: "I am fine, thank you!" }];

      expect(convertAssistantContentToAIGuardMessages(content)).toStrictEqual([
        { role: "assistant", content: "I am fine, thank you!" },
      ]);
    });

    it("should convert tool-call content to assistant message with tool_calls", () => {
      const content = [
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "getWeather",
          args: { city: "Tokyo" },
        },
      ];

      expect(convertAssistantContentToAIGuardMessages(content)).toStrictEqual([
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "call_1", function: { name: "getWeather", arguments: '{"city":"Tokyo"}' } },
          ],
        },
      ]);
    });

    it("should group multiple consecutive tool calls into one message", () => {
      const content = [
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "getWeather",
          args: { city: "Tokyo" },
        },
        {
          type: "tool-call",
          toolCallId: "call_2",
          toolName: "getTime",
          args: { timezone: "Asia/Tokyo" },
        },
      ];

      expect(convertAssistantContentToAIGuardMessages(content)).toStrictEqual([
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "call_1", function: { name: "getWeather", arguments: '{"city":"Tokyo"}' } },
            { id: "call_2", function: { name: "getTime", arguments: '{"timezone":"Asia/Tokyo"}' } },
          ],
        },
      ]);
    });

    it("should split text before tool calls into separate messages", () => {
      const content = [
        { type: "text", text: "Checking Tokyo weather and local time." },
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "getWeather",
          args: { city: "Tokyo" },
        },
        {
          type: "tool-call",
          toolCallId: "call_2",
          toolName: "getTime",
          args: { timezone: "Asia/Tokyo" },
        },
      ];

      expect(convertAssistantContentToAIGuardMessages(content)).toStrictEqual([
        { role: "assistant", content: "Checking Tokyo weather and local time." },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "call_1", function: { name: "getWeather", arguments: '{"city":"Tokyo"}' } },
            { id: "call_2", function: { name: "getTime", arguments: '{"timezone":"Asia/Tokyo"}' } },
          ],
        },
      ]);
    });

    it("should preserve interleaving order (text → tool-call → text)", () => {
      const content = [
        { type: "text", text: "Before tool call." },
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "getWeather",
          args: { city: "Tokyo" },
        },
        { type: "text", text: "After tool call." },
      ];

      expect(convertAssistantContentToAIGuardMessages(content)).toStrictEqual([
        { role: "assistant", content: "Before tool call." },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "call_1", function: { name: "getWeather", arguments: '{"city":"Tokyo"}' } },
          ],
        },
        { role: "assistant", content: "After tool call." },
      ]);
    });

    it("should wrap non-array string content in a single assistant message", () => {
      expect(convertAssistantContentToAIGuardMessages("Simple text")).toStrictEqual([
        { role: "assistant", content: "Simple text" },
      ]);
    });

    it.each([null, undefined])("should return empty assistant message for %s input", (input) => {
      expect(convertAssistantContentToAIGuardMessages(input)).toStrictEqual([
        { role: "assistant", content: "" },
      ]);
    });

    it("should return empty assistant message for empty array", () => {
      expect(convertAssistantContentToAIGuardMessages([])).toStrictEqual([
        { role: "assistant", content: "" },
      ]);
    });

    it("should convert text and image file mixed content to AIGuardContentPart[]", () => {
      const content = [
        { type: "text", text: "I found this screenshot suspicious." },
        { type: "file", mediaType: "image/png", data: "https://example.com/screenshot.png" },
      ];

      expect(convertAssistantContentToAIGuardMessages(content)).toStrictEqual([
        {
          role: "assistant",
          content: [
            { type: "text", text: "I found this screenshot suspicious." },
            { type: "image_url", image_url: { url: "https://example.com/screenshot.png" } },
          ],
        },
      ]);
    });
  });

  describe("extractToolResultContent", () => {
    it("should return empty string when output is undefined", () => {
      expect(extractToolResultContent({})).toBe("");
    });

    it("should return 'null' when output is null", () => {
      expect(extractToolResultContent({ output: null })).toBe("null");
    });

    it("should extract JSON value from output type 'json'", () => {
      expect(
        extractToolResultContent({
          output: { type: "json", value: { temperature: 20, condition: "sunny" } },
        }),
      ).toBe('{"temperature":20,"condition":"sunny"}');
    });

    it("should return 'null' for JSON output with null value", () => {
      expect(extractToolResultContent({ output: { type: "json", value: null } })).toBe("null");
    });

    it("should extract text value from output type 'text'", () => {
      expect(
        extractToolResultContent({ output: { type: "text", value: "Weather is sunny" } }),
      ).toBe("Weather is sunny");
    });

    it("should extract text value from output type 'error-text'", () => {
      expect(
        extractToolResultContent({ output: { type: "error-text", value: "City not found" } }),
      ).toBe("City not found");
    });

    it("should extract JSON value from output type 'error-json'", () => {
      expect(
        extractToolResultContent({
          output: { type: "error-json", value: { code: 404, message: "Not found" } },
        }),
      ).toBe('{"code":404,"message":"Not found"}');
    });

    it("should return 'null' for error-json output with null value", () => {
      expect(extractToolResultContent({ output: { type: "error-json", value: null } })).toBe(
        "null",
      );
    });

    it("should join text parts from output type 'content'", () => {
      expect(
        extractToolResultContent({
          output: {
            type: "content",
            value: [
              { type: "text", text: "Temperature: 20°C. " },
              { type: "text", text: "Condition: sunny." },
              { type: "media", data: "base64...", mediaType: "image/png" },
            ],
          },
        }),
      ).toBe("Temperature: 20°C. Condition: sunny.");
    });

    it("should return raw string when output is a string", () => {
      expect(extractToolResultContent({ output: "raw string" })).toBe("raw string");
    });
  });
});
