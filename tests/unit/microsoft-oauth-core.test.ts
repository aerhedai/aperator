import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMicrosoftAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
} from "@/lib/integrations/microsoft/oauth-core";

describe("buildMicrosoftAuthUrl", () => {
  it("includes the given scopes and redirect_uri", () => {
    const url = new URL(
      buildMicrosoftAuthUrl(
        "state-1",
        ["openid", "offline_access", "Mail.Read"],
        "http://localhost:3000/api/integrations/outlook/callback",
      ),
    );

    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("scope")).toBe(
      "openid offline_access Mail.Read",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/integrations/outlook/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-1");
  });
});

describe("exchangeCodeForTokens", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a successful token response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeCodeForTokens(
      "code-1",
      "http://localhost:3000/api/integrations/outlook/callback",
    );

    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.refreshToken).toBe("refresh-1");
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(tokens.email).toBeNull();
  });

  // Found live: Graph's /me endpoint can fail with a backend "Store" error
  // for some accounts even though the OAuth exchange itself succeeds
  // cleanly — decoding the id_token's own email claim avoids that
  // dependency entirely for the one thing this app needs from it.
  it("decodes the email claim from the id_token when present, without any Graph call", async () => {
    const idTokenPayload = Buffer.from(
      JSON.stringify({ email: "user@example.test", sub: "abc123" }),
    ).toString("base64url");
    const idToken = `header.${idTokenPayload}.signature`;

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 3600,
            id_token: idToken,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeCodeForTokens(
      "code-1",
      "http://localhost:3000/api/integrations/outlook/callback",
    );

    expect(tokens.email).toBe("user@example.test");
    // Only the token endpoint was called — no separate Graph /me request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to preferred_username when the id_token has no email claim", async () => {
    const idTokenPayload = Buffer.from(
      JSON.stringify({ preferred_username: "fallback@example.test" }),
    ).toString("base64url");
    const idToken = `header.${idTokenPayload}.signature`;

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 3600,
            id_token: idToken,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeCodeForTokens(
      "code-1",
      "http://localhost:3000/api/integrations/outlook/callback",
    );

    expect(tokens.email).toBe("fallback@example.test");
  });

  it("captures the actually-granted scope from the token response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 3600,
            scope: "openid offline_access Mail.Read",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeCodeForTokens(
      "code-1",
      "http://localhost:3000/api/integrations/outlook/callback",
    );

    expect(tokens.scope).toBe("openid offline_access Mail.Read");
  });

  it("throws a clear reconnect error when no refresh_token is returned", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: "access-1", expires_in: 3600 }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      exchangeCodeForTokens(
        "code-1",
        "http://localhost:3000/api/integrations/outlook/callback",
      ),
    ).rejects.toThrow(/did not return a refresh token/);
  });

  it("throws using Microsoft's own error fields on a non-2xx response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "The provided code is invalid.",
          }),
          { status: 400 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      exchangeCodeForTokens(
        "bad-code",
        "http://localhost:3000/api/integrations/outlook/callback",
      ),
    ).rejects.toThrow(/The provided code is invalid/);
  });
});

// The one real gotcha this file locks in: unlike Google, Microsoft may
// rotate the refresh_token on refresh — a caller that silently ignores a
// returned refresh_token and keeps reusing the old one risks the old one
// eventually being invalidated.
describe("refreshAccessToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces a new refresh_token when Microsoft rotates it", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "access-2",
            refresh_token: "refresh-2-rotated",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshAccessToken("refresh-1");

    expect(result.accessToken).toBe("access-2");
    expect(result.refreshToken).toBe("refresh-2-rotated");
  });

  it("leaves refreshToken undefined when Microsoft doesn't rotate it", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: "access-2", expires_in: 3600 }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshAccessToken("refresh-1");

    expect(result.accessToken).toBe("access-2");
    expect(result.refreshToken).toBeUndefined();
  });
});
