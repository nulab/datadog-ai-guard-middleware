import type {
  LanguageModelV4FilePart,
  LanguageModelV4Message,
  LanguageModelV4ToolResultOutput,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { convertToAIGuardFormat } from "./convert.js";

const imageCases: { name: string; file: LanguageModelV4FilePart; url: string }[] = [
  {
    name: "bytes",
    file: {
      type: "file",
      mediaType: "image/png",
      data: { type: "data", data: new Uint8Array([1, 2, 3]) },
    },
    url: "data:image/png;base64,AQID",
  },
  {
    name: "base64",
    file: { type: "file", mediaType: "image/png", data: { type: "data", data: "AQID" } },
    url: "data:image/png;base64,AQID",
  },
  {
    name: "URL",
    file: {
      type: "file",
      mediaType: "image/png",
      data: { type: "url", url: new URL("https://example.com/image.png") },
    },
    url: "https://example.com/image.png",
  },
  {
    name: "image media type with a URL",
    file: {
      type: "file",
      mediaType: "image",
      data: { type: "url", url: new URL("https://example.com/image.png") },
    },
    url: "https://example.com/image.png",
  },
];

describe("V4 message conversion", () => {
  describe.each(["user", "assistant"] as const)("%s images", (role) => {
    it.each(imageCases)("preserves text and $name images for evaluation", ({ file, url }) => {
      const prompt: LanguageModelV4Message[] = [
        {
          role,
          content: [{ type: "text", text: "Before" }, file, { type: "text", text: "After" }],
        },
      ];
      const original = JSON.stringify(prompt);
      expect(convertToAIGuardFormat(prompt)).toEqual([
        {
          role,
          content: [
            { type: "text", text: "Before" },
            { type: "image_url", image_url: { url } },
            { type: "text", text: "After" },
          ],
        },
      ]);
      expect(JSON.stringify(prompt)).toBe(original);
      expect(Array.isArray(prompt[0]?.content) && prompt[0].content[1]).toBe(file);
    });
  });

  it("keeps assistant images interleaved with tool calls", () => {
    const prompt: LanguageModelV4Message[] = [
      {
        role: "assistant",
        content: [
          { type: "file", mediaType: "image/png", data: { type: "data", data: "AQID" } },
          { type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: { query: "test" } },
          { type: "text", text: "After" },
        ],
      },
    ];
    expect(convertToAIGuardFormat(prompt)).toEqual([
      {
        role: "assistant",
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
      },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call-1", function: { name: "lookup", arguments: '{"query":"test"}' } }],
      },
      { role: "assistant", content: "After" },
    ]);
  });

  it("keeps the existing exclusions for non-image files and provider references", () => {
    const prompt: LanguageModelV4Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Visible" },
          { type: "file", mediaType: "application/pdf", data: { type: "data", data: "AQID" } },
          {
            type: "file",
            mediaType: "text/plain",
            data: { type: "text", text: "Not newly evaluated" },
          },
          {
            type: "file",
            mediaType: "image/png",
            data: { type: "reference", reference: { openai: "file-123" } },
          },
        ],
      },
    ];
    expect(convertToAIGuardFormat(prompt)).toEqual([{ role: "user", content: "Visible" }]);
  });

  const outputs: { output: LanguageModelV4ToolResultOutput; expected: string }[] = [
    { output: { type: "text", value: "Result" }, expected: "Result" },
    { output: { type: "json", value: { value: 1 } }, expected: '{"value":1}' },
    { output: { type: "error-text", value: "Failed" }, expected: "Failed" },
    { output: { type: "error-json", value: { error: true } }, expected: '{"error":true}' },
    { output: { type: "execution-denied", reason: "Denied" }, expected: "" },
    {
      output: {
        type: "content",
        value: [
          { type: "text", text: "Before" },
          { type: "file", mediaType: "image/png", data: { type: "data", data: "AQID" } },
          { type: "text", text: "After" },
        ],
      },
      expected: "BeforeAfter",
    },
  ];
  it.each(outputs)(
    "preserves existing tool-result behavior for $output.type",
    ({ output, expected }) => {
      const prompt: LanguageModelV4Message[] = [
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-1", toolName: "lookup", output }],
        },
      ];
      expect(convertToAIGuardFormat(prompt)).toEqual([
        { role: "tool", tool_call_id: "call-1", content: expected },
      ]);
    },
  );
});
