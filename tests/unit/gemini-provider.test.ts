import { afterEach, describe, expect, it, vi } from "vitest";

import { GeminiProvider } from "@/lib/ai/providers/gemini-provider";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("GeminiProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the request to generateContent with the api key as a header, not a query param", async () => {
    const fetchMock = vi.fn(async () =>
      response({ candidates: [{ content: { parts: [{ text: "pong" }] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("real-key");
    const result = await provider.generateResponse({
      model: "gemini-3.5-flash",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(result.content).toBe("pong");
    const [url, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
    );
    expect(url).not.toContain("real-key");
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("real-key");
  });

  it("sends thinkingBudget: 0 by default, as a cost ceiling — not proven to reduce tokens on every call, see gemini-provider.ts's own comment", async () => {
    const fetchMock = vi.fn(async () =>
      response({ candidates: [{ content: { parts: [{ text: "pong" }] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("key");
    await provider.generateResponse({
      model: "gemini-3.5-flash",
      messages: [{ role: "user", content: "ping" }],
    });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.generationConfig.thinkingConfig).toEqual({
      thinkingBudget: 0,
    });
  });

  it("retries once without thinkingConfig when a model rejects it, rather than failing outright", async () => {
    // Live-confirmed: gemini-3.5-flash-lite hard-rejects thinkingBudget: 0
    // with a 400 "Request contains an invalid argument" — sending it
    // unconditionally would make that model entirely unusable, not just
    // lose the optimization.
    let call = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      call += 1;
      const body = JSON.parse(init.body as string);
      if (call === 1) {
        expect(body.generationConfig.thinkingConfig).toBeDefined();
        return response(
          {
            error: {
              code: 400,
              message: "Request contains an invalid argument.",
              status: "INVALID_ARGUMENT",
            },
          },
          400,
        );
      }
      expect(body.generationConfig.thinkingConfig).toBeUndefined();
      return response({
        candidates: [{ content: { parts: [{ text: "pong" }] } }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("key");
    const result = await provider.generateResponse({
      model: "gemini-3.5-flash-lite",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(result.content).toBe("pong");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 400 exactly once, and surfaces the error if it wasn't caused by thinkingConfig", async () => {
    // Google's 400 for an unsupported thinkingConfig ("Request contains an
    // invalid argument") is indistinguishable by message from any other
    // malformed-request 400 — confirmed live, there's nothing in the text
    // naming thinkingConfig specifically. So every 400 gets exactly one
    // retry without it; if that wasn't the actual cause, the retry fails
    // the same way and that failure is what surfaces, not a silently
    // swallowed or endlessly repeated one.
    const fetchMock = vi.fn(async () =>
      response(
        {
          error: {
            code: 400,
            message: "Request contains an invalid argument.",
            status: "INVALID_ARGUMENT",
          },
        },
        400,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("key");
    await expect(
      provider.generateResponse({
        model: "gemini-3.5-flash",
        messages: [{ role: "user", content: "ping" }],
      }),
    ).rejects.toThrow("Gemini request failed: 400");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-400 error, even from the model that's known to reject thinkingConfig", async () => {
    const fetchMock = vi.fn(async () =>
      response(
        {
          error: {
            code: 503,
            message: "This model is currently experiencing high demand.",
            status: "UNAVAILABLE",
          },
        },
        503,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("key");
    await expect(
      provider.generateResponse({
        model: "gemini-3.5-flash-lite",
        messages: [{ role: "user", content: "ping" }],
      }),
    ).rejects.toThrow("Gemini request failed: 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends responseFormat json as generationConfig.responseMimeType, alongside thinkingConfig", async () => {
    const fetchMock = vi.fn(async () =>
      response({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("key");
    await provider.generateResponse({
      model: "gemini-3.5-flash",
      messages: [{ role: "user", content: "ping" }],
      responseFormat: "json",
    });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.generationConfig).toEqual({
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    });
  });

  it("throws a descriptive error on a non-ok, non-retriable response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("not found", { status: 404, statusText: "Not Found" }),
      ),
    );

    const provider = new GeminiProvider("key");
    await expect(
      provider.generateResponse({ model: "missing-model", messages: [] }),
    ).rejects.toThrow("Gemini request failed: 404 Not Found");
  });
});
