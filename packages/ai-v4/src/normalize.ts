import type { LanguageModelV4Content, LanguageModelV4Message } from "@ai-sdk/provider";

type ContentPart =
  | LanguageModelV4Content
  | Exclude<LanguageModelV4Message, { role: "system" }>["content"][number];

/** Adapt V4 files for the SDK-independent core without changing the model's data. */
export function normalizeContent(content: ContentPart[]) {
  if (!Array.isArray(content)) return content;

  return content.map((part) => {
    if (part.type !== "file") return part;

    switch (part.data.type) {
      case "data":
        return { ...part, data: part.data.data };
      case "url":
        return {
          ...part,
          mediaType: part.mediaType === "image" ? "image/*" : part.mediaType,
          data: part.data.originalUrl ?? part.data.url,
        };
      case "reference":
      case "text":
        return part;
      default: {
        const exhaustive: never = part.data;
        return exhaustive;
      }
    }
  });
}
