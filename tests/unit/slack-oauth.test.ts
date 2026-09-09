import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { generatePkcePair } from "@/lib/integrations/pkce";
import {
  buildSlackAuthUrl,
  exchangeSlackCode,
} from "@/lib/integrations/slack/oauth";

// Slack's Web API returns HTTP 200 even when a request fails — the real
// gotcha this file locks in is that exchangeSlackCode must check the JSON
// `ok` field, not response.ok, or a failed exchange would silently look
// like a success with undefined token fields.
describe("exchangeSlackCode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a successful oauth.v2.access response into SlackTokens", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            access_token: "xoxb-fake-token",
            bot_user_id: "U123ABC",
            team: { id: "T123ABC", name: "Acme Workspace" },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeSlackCode("fake-code");

    expect(tokens).toEqual({
      botToken: "xoxb-fake-token",
      botUserId: "U123ABC",
      teamId: "T123ABC",
      teamName: "Acme Workspace",
      expiresAt: null,
      userAccessToken: null,
      authedUserId: null,
    });
  });

  it("captures authed_user's access token when the user granted user_scope permissions", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            access_token: "xoxb-fake-token",
            bot_user_id: "U123ABC",
            team: { id: "T123ABC", name: "Acme Workspace" },
            authed_user: { id: "U456DEF", access_token: "xoxp-fake-token" },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeSlackCode("fake-code");

    expect(tokens.userAccessToken).toBe("xoxp-fake-token");
    expect(tokens.authedUserId).toBe("U456DEF");
  });

  it("throws using Slack's own error field when ok is false, despite HTTP 200", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: "invalid_code" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(exchangeSlackCode("bad-code")).rejects.toThrow(/invalid_code/);
  });

  it("includes code_verifier in the token request when provided", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            access_token: "xoxb-fake-token",
            bot_user_id: "U123ABC",
            team: { id: "T123ABC", name: "Acme Workspace" },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await exchangeSlackCode("fake-code", "the-verifier");

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("code_verifier")).toBe("the-verifier");
  });
});

// PKCE (RFC 7636) — required by Slack's OAuth for a redirect_uri that isn't
// a real HTTPS URL (localhost during local dev counts as "non-web" in
// Slack's eyes; hit live: "Must use PKCE to redirect to a non-web URI").
describe("generatePkcePair / buildSlackAuthUrl PKCE params", () => {
  it("codeChallenge is the base64url-SHA256 of codeVerifier, per RFC 7636", () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();

    const expected = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    expect(codeChallenge).toBe(expected);
  });

  it("buildSlackAuthUrl includes code_challenge/code_challenge_method only when a challenge is given", () => {
    const withoutPkce = new URL(buildSlackAuthUrl("state-1"));
    expect(withoutPkce.searchParams.has("code_challenge")).toBe(false);

    const withPkce = new URL(buildSlackAuthUrl("state-1", "the-challenge"));
    expect(withPkce.searchParams.get("code_challenge")).toBe("the-challenge");
    expect(withPkce.searchParams.get("code_challenge_method")).toBe("S256");
  });
});
