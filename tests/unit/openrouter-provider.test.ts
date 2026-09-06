import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenRouterProvider } from "@/lib/ai/providers/openrouter-provider";

describe("OpenRouterProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the request in OpenAI chat-completions shape and parses the response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "pong" } }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenRouterProvider("real-key");
    const result = await provider.generateResponse({
      model: "upstage/solar-pro4",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(result).toEqual({ content: "pong" });
    const [url, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = requestInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer real-key");
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody).toEqual({
      model: "upstage/solar-pro4",
      messages: [{ role: "user", content: "ping" }],
    });
  });

  it("captures token usage from usage.prompt_tokens/completion_tokens", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "pong" } }],
            usage: { prompt_tokens: 42, completion_tokens: 7 },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenRouterProvider("key");
    const result = await provider.generateResponse({
      model: "upstage/solar-pro4",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(result.usage).toEqual({ promptTokens: 42, completionTokens: 7 });
  });

  it("omits usage when the response doesn't report it", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "pong" } }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenRouterProvider("key");
    const result = await provider.generateResponse({
      model: "upstage/solar-pro4",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(result.usage).toBeUndefined();
  });

  it("sends a tool call's arguments as a JSON string, parses a response's arguments back into an object", async () => {
    // The one real way this differs from Ollama's near-identical shape:
    // OpenAI-compatible arguments travel as a JSON *string* in both
    // directions, not an object. Getting this backwards either way would
    // silently break every real tool call.
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sentBody = JSON.parse(init.body as string);
      expect(sentBody.messages[0].tool_calls[0].function.arguments).toBe(
        '{"sku":"W1"}',
      );
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_real_id",
                    type: "function",
                    function: {
                      name: "find_record",
                      arguments:
                        '{"recordType":"Product","field":"sku","value":"W1"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenRouterProvider("key");
    const result = await provider.generateResponse({
      model: "upstage/solar-pro4",
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_0", name: "find_record", arguments: { sku: "W1" } },
          ],
        },
      ],
    });

    // The real id OpenRouter returned is used as-is — unlike Ollama and
    // Gemini, which never return one and need an index-based id
    // synthesized instead.
    expect(result.toolCalls).toEqual([
      {
        id: "call_real_id",
        name: "find_record",
        arguments: { recordType: "Product", field: "sku", value: "W1" },
      },
    ]);
  });

  it("falls back to empty arguments rather than crashing on a malformed tool call", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      function: {
                        name: "find_record",
                        arguments: "not valid json",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenRouterProvider("key");
    const result = await provider.generateResponse({
      model: "upstage/solar-pro4",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "find_record", arguments: {} },
    ]);
  });

  it("round-trips a tool result message with its tool_call_id, unchanged from AIMessage's own field name convention", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "done" } }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenRouterProvider("key");
    await provider.generateResponse({
      model: "upstage/solar-pro4",
      messages: [
        { role: "tool", content: '{"found":true}', toolCallId: "call_0" },
      ],
    });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.messages).toEqual([
      { role: "tool", content: '{"found":true}', tool_call_id: "call_0" },
    ]);
  });

  it("sends responseFormat json as response_format: {type: json_object}", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "{}" } }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenRouterProvider("key");
    await provider.generateResponse({
      model: "upstage/solar-pro4",
      messages: [{ role: "user", content: "ping" }],
      responseFormat: "json",
    });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.response_format).toEqual({ type: "json_object" });
  });

  it("throws a descriptive error on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("model not found", {
            status: 404,
            statusText: "Not Found",
          }),
      ),
    );

    const provider = new OpenRouterProvider("key");
    await expect(
      provider.generateResponse({ model: "missing-model", messages: [] }),
    ).rejects.toThrow("OpenRouter request failed: 404 Not Found");
  });

  it("throws a clear error when the response has no choices, rather than crashing on undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [] }))),
    );

    const provider = new OpenRouterProvider("key");
    await expect(
      provider.generateResponse({
        model: "upstage/solar-pro4",
        messages: [{ role: "user", content: "ping" }],
      }),
    ).rejects.toThrow("OpenRouter returned no choices");
  });
});
