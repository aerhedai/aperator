import { describe, expect, it } from "vitest";

import { getAvailableTools } from "@/lib/mcp/scope-tool-map";

describe("getAvailableTools", () => {
  it("returns every tool a fully-granted provider unlocks", () => {
    expect(getAvailableTools("gmail", ["https://mail.google.com/"])).toEqual(
      new Set(["GMAIL_SEND_EMAIL", "GMAIL_READ_INBOX"]),
    );
  });

  it("returns nothing for a provider with no matching granted scope", () => {
    expect(getAvailableTools("gmail", ["openid", "email"])).toEqual(new Set());
  });

  it("returns nothing for an unknown provider", () => {
    expect(getAvailableTools("not-a-real-provider", ["anything"])).toEqual(
      new Set(),
    );
  });

  it("resolves a genuinely partial grant — Outlook Mail.Read without Mail.Send", () => {
    const result = getAvailableTools("outlook", [
      "https://graph.microsoft.com/Mail.Read",
    ]);
    expect(result).toEqual(new Set(["OUTLOOK_READ_INBOX"]));
    expect(result.has("OUTLOOK_SEND_EMAIL")).toBe(false);
  });

  it("Calendars.ReadWrite unlocks both calendar tools; Calendars.Read alone unlocks only the read one", () => {
    expect(
      getAvailableTools("outlook-calendar", [
        "https://graph.microsoft.com/Calendars.ReadWrite",
      ]),
    ).toEqual(
      new Set([
        "OUTLOOK_CHECK_CALENDAR_AVAILABILITY",
        "OUTLOOK_CREATE_CALENDAR_EVENT",
      ]),
    );
    expect(
      getAvailableTools("outlook-calendar", [
        "https://graph.microsoft.com/Calendars.Read",
      ]),
    ).toEqual(new Set(["OUTLOOK_CHECK_CALENDAR_AVAILABILITY"]));
  });

  it("matches Microsoft Graph scopes case-insensitively", () => {
    // Real-world uncertainty this guards against: Microsoft's own docs
    // disagree on whether a granted scope echoes back capitalized
    // ("Mail.Read") or lowercase ("mail.read").
    expect(
      getAvailableTools("outlook", ["https://graph.microsoft.com/mail.send"]),
    ).toEqual(new Set(["OUTLOOK_SEND_EMAIL"]));
  });

  it("dedupes a tool unlocked by more than one granted scope", () => {
    const result = getAvailableTools("outlook", [
      "https://graph.microsoft.com/Mail.Read",
      "https://graph.microsoft.com/Mail.ReadWrite",
    ]);
    expect(result).toEqual(new Set(["OUTLOOK_READ_INBOX"]));
  });
});
