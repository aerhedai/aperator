import { describe, expect, it } from "vitest";

import { cleanEmailBody } from "@/lib/integrations/shared/clean-email-body";

describe("cleanEmailBody", () => {
  it("strips a signature after a standalone -- delimiter", () => {
    const raw =
      "Can you provide a quote for 500 units of Product A?\n--\nJohn Smith\nHead of Procurement\nAcme Corp | +1 555 0100";
    expect(cleanEmailBody(raw)).toBe(
      "Can you provide a quote for 500 units of Product A?",
    );
  });

  it("strips common mobile-client footers", () => {
    expect(cleanEmailBody("Please send a quote.\nSent from my iPhone")).toBe(
      "Please send a quote.",
    );
    expect(cleanEmailBody("Please send a quote.\nGet Outlook for iOS")).toBe(
      "Please send a quote.",
    );
  });

  it("collapses excessive blank lines without removing content", () => {
    expect(cleanEmailBody("Line one.\n\n\n\n\nLine two.")).toBe(
      "Line one.\n\nLine two.",
    );
  });

  it("never strips forwarded/quoted content — the real request can be inside it", () => {
    const raw =
      "Rohan Patel\n\nBegin forwarded message:\n\nFrom: rohan patel\nSubject: Quote Request\n\nHi, can you provide a quote for 500 units of Product A?";
    expect(cleanEmailBody(raw)).toContain(
      "Hi, can you provide a quote for 500 units of Product A?",
    );
    expect(cleanEmailBody(raw)).toContain("Begin forwarded message:");
  });

  it("normalizes CRLF line endings and trims surrounding whitespace", () => {
    expect(cleanEmailBody("\r\n  Hello there.  \r\n\r\n")).toBe("Hello there.");
  });
});
