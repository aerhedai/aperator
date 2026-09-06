import { describe, expect, it } from "vitest";

import type { AIMessage } from "@/lib/ai/provider";
import {
  GeminiEmptyResponseError,
  fromGeminiResponse,
  toGeminiContents,
  toGeminiTools,
} from "@/lib/ai/providers/gemini-message-mapping";

// This translation layer exists because Gemini's wire format genuinely
// differs from the OpenAI/Ollama shape the rest of this app assumes — no
// system role, no tool role, and a functionResponse part that needs a
// name AIMessage never carries. Getting any of these three wrong fails
// silently in production (a malformed request Gemini rejects, or a
// mis-paired tool result), so each is pinned down here rather than
// eyeballed.
describe("toGeminiContents", () => {
  it("moves a system message into systemInstruction, not contents", () => {
    const messages: AIMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ];
    const result = toGeminiContents(messages);
    expect(result.systemInstruction).toEqual({
      parts: [{ text: "You are helpful." }],
    });
    expect(result.contents).toEqual([
      { role: "user", parts: [{ text: "Hi" }] },
    ]);
  });

  it("omits systemInstruction entirely when there's no system message", () => {
    const result = toGeminiContents([{ role: "user", content: "Hi" }]);
    expect(result.systemInstruction).toBeUndefined();
  });

  it("joins multiple system messages, in order", () => {
    const result = toGeminiContents([
      { role: "system", content: "First." },
      { role: "system", content: "Second." },
      { role: "user", content: "Hi" },
    ]);
    expect(result.systemInstruction?.parts[0].text).toBe("First.\n\nSecond.");
  });

  it("maps assistant -> model, with a functionCall part per tool call", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "Quote 5 widgets" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call_0", name: "find_record", arguments: { sku: "W1" } },
        ],
      },
    ];
    const result = toGeminiContents(messages);
    expect(result.contents[1]).toEqual({
      role: "model",
      // No text part: message.content is "", which is falsy, so no
      // placeholder empty {text: ""} part is emitted alongside the real
      // functionCall part.
      parts: [{ functionCall: { name: "find_record", args: { sku: "W1" } } }],
    });
  });
});

describe("toGeminiContents: functionResponse role and name recovery", () => {
  it("sends a tool result as role:user with a functionResponse part, not role:tool", () => {
    // Confirmed against Google's own documented curl example: a
    // functionResponse turn uses role "user". Gemini has no "tool" or
    // "function" role at the Content level — getting this wrong is exactly
    // the kind of mistake that would only surface once a real LOOP agent
    // tries to use a tool in production.
    const messages: AIMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call_0", name: "find_record", arguments: { sku: "W1" } },
        ],
      },
      {
        role: "tool",
        content: JSON.stringify({ id: "prod-1", name: "Widget" }),
        toolCallId: "call_0",
      },
    ];
    const result = toGeminiContents(messages);
    const toolTurn = result.contents[1]!;
    expect(toolTurn.role).toBe("user");
    expect(toolTurn.parts[0]!.functionResponse).toEqual({
      name: "find_record",
      response: { id: "prod-1", name: "Widget" },
    });
  });

  it("recovers the function name from the preceding assistant turn via toolCallId", () => {
    // The whole reason this module exists rather than a one-line rename:
    // AIMessage's tool-role entries never carry a name, only toolCallId.
    const messages: AIMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_0", name: "search_records", arguments: {} }],
      },
      { role: "tool", content: "{}", toolCallId: "call_0" },
    ];
    const result = toGeminiContents(messages);
    expect(result.contents[1]!.parts[0]!.functionResponse?.name).toBe(
      "search_records",
    );
  });

  it("wraps a non-object tool result body under 'result', since Gemini requires an object", () => {
    const messages: AIMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_0", name: "count", arguments: {} }],
      },
      { role: "tool", content: "42", toolCallId: "call_0" },
    ];
    const result = toGeminiContents(messages);
    expect(result.contents[1]!.parts[0]!.functionResponse?.response).toEqual({
      result: 42,
    });
  });

  it("falls back to a placeholder name for an orphaned tool result rather than throwing", () => {
    const messages: AIMessage[] = [
      { role: "tool", content: "{}", toolCallId: "unknown_call" },
    ];
    const result = toGeminiContents(messages);
    expect(result.contents[0]!.parts[0]!.functionResponse?.name).toBe(
      "unknown_function",
    );
  });

  it("batches multiple tool results from one turn into a single user turn with multiple parts", () => {
    // Matches Gemini's own documented parallel-function-calling pattern —
    // one role:"user" turn per assistant turn, not one per tool call.
    const messages: AIMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call_0", name: "find_record", arguments: {} },
          { id: "call_1", name: "search_records", arguments: {} },
        ],
      },
      { role: "tool", content: "{}", toolCallId: "call_0" },
      { role: "tool", content: "{}", toolCallId: "call_1" },
      { role: "user", content: "thanks" },
    ];
    const result = toGeminiContents(messages);
    expect(result.contents).toHaveLength(3); // model, user(x2 batched), user
    expect(result.contents[1]!.role).toBe("user");
    expect(result.contents[1]!.parts).toHaveLength(2);
    expect(result.contents[1]!.parts[0]!.functionResponse?.name).toBe(
      "find_record",
    );
    expect(result.contents[1]!.parts[1]!.functionResponse?.name).toBe(
      "search_records",
    );
    expect(result.contents[2]).toEqual({
      role: "user",
      parts: [{ text: "thanks" }],
    });
  });
});

describe("toGeminiTools", () => {
  it("returns undefined for no tools, so the request omits the field entirely", () => {
    expect(toGeminiTools(undefined)).toBeUndefined();
    expect(toGeminiTools([])).toBeUndefined();
  });

  it("wraps tool definitions in one functionDeclarations block", () => {
    const result = toGeminiTools([
      {
        name: "find_record",
        description: "Find a record.",
        parameters: { type: "object", properties: {} },
      },
    ]);
    expect(result).toEqual([
      {
        functionDeclarations: [
          {
            name: "find_record",
            description: "Find a record.",
            parameters: { type: "object", properties: {} },
          },
        ],
      },
    ]);
  });
});

describe("fromGeminiResponse", () => {
  it("extracts plain text content", () => {
    const result = fromGeminiResponse({
      candidates: [{ content: { parts: [{ text: "Hello there" }] } }],
    });
    expect(result.content).toBe("Hello there");
    expect(result.toolCalls).toBeUndefined();
  });

  it("extracts a function call and synthesizes a stable index-based id", () => {
    // Gemini never returns an id for a function call, same situation
    // OllamaProvider is already in — same synthesis strategy, for the same
    // reason: an index is stable within one response, which is all a
    // caller needs to pair a result back to its request.
    const result = fromGeminiResponse({
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: "find_record", args: { sku: "W1" } } },
            ],
          },
        },
      ],
    });
    expect(result.toolCalls).toEqual([
      { id: "call_0", name: "find_record", arguments: { sku: "W1" } },
    ]);
  });

  it("assigns sequential ids across multiple parallel function calls", () => {
    const result = fromGeminiResponse({
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: "a", args: {} } },
              { functionCall: { name: "b", args: {} } },
            ],
          },
        },
      ],
    });
    expect(result.toolCalls?.map((c) => c.id)).toEqual(["call_0", "call_1"]);
  });

  it("reports usage when Gemini includes it", () => {
    const result = fromGeminiResponse({
      candidates: [{ content: { parts: [{ text: "Hi" }] } }],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 },
    });
    expect(result.usage).toEqual({ promptTokens: 50, completionTokens: 10 });
  });

  it("omits usage when Gemini doesn't report it, rather than defaulting to 0", () => {
    const result = fromGeminiResponse({
      candidates: [{ content: { parts: [{ text: "Hi" }] } }],
    });
    expect(result.usage).toBeUndefined();
  });

  it("throws GeminiEmptyResponseError with the block reason when the prompt was blocked", () => {
    expect(() =>
      fromGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } }),
    ).toThrow(GeminiEmptyResponseError);
    expect(() =>
      fromGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } }),
    ).toThrow(/SAFETY/);
  });

  it("throws GeminiEmptyResponseError for no candidates and no block reason", () => {
    expect(() => fromGeminiResponse({})).toThrow(GeminiEmptyResponseError);
  });
});
