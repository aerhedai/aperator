import { describe, expect, it } from "vitest";

import {
  buildMcpToolName,
  MAX_TOOL_NAME_LENGTH,
  parseMcpToolName,
} from "@/lib/integrations/mcp/tool-naming";

describe("buildMcpToolName / parseMcpToolName", () => {
  it("round-trips a simple integration id and tool name", () => {
    const name = buildMcpToolName("clx123abc", "search_pages");
    expect(name).toBe("mcp__clx123abc__search_pages");
    expect(parseMcpToolName(name)).toEqual({
      integrationId: "clx123abc",
      remoteToolName: "search_pages",
    });
  });

  it("never uses a colon — invalid for the MCP SDK's own tool-name validator and for Gemini/OpenAI-compatible function-calling APIs", () => {
    const name = buildMcpToolName("clx123abc", "search_pages");
    expect(name).not.toContain(":");
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("preserves a remote tool name that itself contains a double underscore", () => {
    const name = buildMcpToolName("clx123abc", "namespace__sub_tool");
    expect(parseMcpToolName(name)).toEqual({
      integrationId: "clx123abc",
      remoteToolName: "namespace__sub_tool",
    });
  });

  it("sanitizes characters outside the MCP-safe set (letters, digits, underscore, dash, dot)", () => {
    const name = buildMcpToolName("clx123abc", "search:pages/v1");
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("returns null for a name with no mcp__ prefix", () => {
    expect(parseMcpToolName("find_record")).toBeNull();
  });

  it("returns null for a malformed mcp__ name with no second segment", () => {
    expect(parseMcpToolName("mcp__onlyoneseg")).toBeNull();
  });

  it("returns null for the bare prefix with an empty remainder", () => {
    expect(parseMcpToolName("mcp__")).toBeNull();
  });

  it("returns null when the separator is present but the remote tool name is empty", () => {
    expect(parseMcpToolName("mcp__someintegrationid__")).toBeNull();
  });

  it("never produces a name longer than the 64-character limit Gemini/OpenAI-compatible providers enforce, even for a very long remote tool name", () => {
    const realisticCuid = "cljk2p9qz0000qzrmn831p5xy"; // 25 chars, a real cuid's shape
    const veryLongRemoteName =
      "search_customer_records_by_multiple_criteria_including_email_and_phone_number_and_signup_date";

    const name = buildMcpToolName(realisticCuid, veryLongRemoteName);

    expect(name.length).toBeLessThanOrEqual(MAX_TOOL_NAME_LENGTH);
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);

    // Still round-trips: parsing back out yields a value that re-encodes
    // to itself (the property findMcpTool's re-encoding match relies on —
    // see integration-service.ts), not a crash or a null.
    const parsed = parseMcpToolName(name);
    expect(parsed).not.toBeNull();
    expect(parsed?.integrationId).toBe(realisticCuid);
    expect(parsed?.remoteToolName.length).toBeGreaterThan(0);
  });

  it("disambiguates two long remote tool names that share a truncated prefix", () => {
    const realisticCuid = "cljk2p9qz0000qzrmn831p5xy";
    const base = "search_customer_records_by_multiple_criteria_including_email";
    const nameA = buildMcpToolName(realisticCuid, `${base}_and_phone`);
    const nameB = buildMcpToolName(realisticCuid, `${base}_and_address`);

    expect(nameA).not.toBe(nameB);
    expect(nameA.length).toBeLessThanOrEqual(MAX_TOOL_NAME_LENGTH);
    expect(nameB.length).toBeLessThanOrEqual(MAX_TOOL_NAME_LENGTH);
  });
});
