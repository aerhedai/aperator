import { describe, expect, it } from "vitest";

import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";

describe("translateScopeError", () => {
  it("translates a Google/Microsoft-style 403 into a clear access-denied message", () => {
    const error = new Error(
      'Gmail API request to /messages/send failed (403): {"error":{"code":403,"message":"Request had insufficient authentication scopes."}}',
    );
    expect(translateScopeError(error)).toBe(
      "Tool access denied — the connected account no longer grants this permission. Reconnect it from Settings if this capability is still needed.",
    );
  });

  it("translates Slack's missing_scope error the same way", () => {
    const error = new Error("Slack chat.postMessage failed: missing_scope");
    expect(translateScopeError(error)).toBe(
      "Tool access denied — the connected account no longer grants this permission. Reconnect it from Settings if this capability is still needed.",
    );
  });

  it("leaves a 401 (expired/invalid token, not a scope problem) unchanged", () => {
    const error = new Error(
      "Gmail API request to /messages/send failed (401): invalid_grant",
    );
    expect(translateScopeError(error)).toBe(error.message);
  });

  it("leaves an unrelated error message unchanged", () => {
    const error = new Error("Gmail is not connected for this organisation.");
    expect(translateScopeError(error)).toBe(error.message);
  });

  it("handles a non-Error thrown value", () => {
    expect(translateScopeError("some string")).toBe("some string");
  });
});
