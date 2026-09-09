import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
} from "@/lib/integrations/google/oauth-core";

describe("buildGoogleAuthUrl", () => {
  it("includes the given scopes and redirect_uri", () => {
    const url = new URL(
      buildGoogleAuthUrl(
        "state-1",
        ["https://www.googleapis.com/auth/drive.file", "openid", "email"],
        "http://localhost:3000/api/integrations/google-drive/callback",
      ),
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/drive.file openid email",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/integrations/google-drive/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("access_type")).toBe("offline");
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
      "http://localhost:3000/api/integrations/google-drive/callback",
    );

    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.refreshToken).toBe("refresh-1");
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());
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
        "http://localhost:3000/api/integrations/google-drive/callback",
      ),
    ).rejects.toThrow(/did not return a refresh token/);
  });

  it("captures the actually-granted scope from the token response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/drive.file openid email",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeCodeForTokens(
      "code-1",
      "http://localhost:3000/api/integrations/google-drive/callback",
    );

    expect(tokens.scope).toBe(
      "https://www.googleapis.com/auth/drive.file openid email",
    );
  });

  it("throws using Google's own error fields on a non-2xx response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Malformed auth code.",
          }),
          { status: 400 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      exchangeCodeForTokens(
        "bad-code",
        "http://localhost:3000/api/integrations/google-drive/callback",
      ),
    ).rejects.toThrow(/Malformed auth code/);
  });
});

describe("refreshAccessToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a fresh access token and expiry", async () => {
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
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
