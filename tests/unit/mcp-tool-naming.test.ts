import { describe, expect, it } from "vitest";

import {
  buildMcpToolName,
  parseMcpToolName,
} from "@/lib/integrations/mcp/tool-naming";

describe("buildMcpToolName / parseMcpToolName", () => {
  it("round-trips a simple integration id and tool name", () => {
    const name = buildMcpToolName("clx123abc", "search_pages");
    expect(name).toBe("mcp:clx123abc:search_pages");
    expect(parseMcpToolName(name)).toEqual({
      integrationId: "clx123abc",
      remoteToolName: "search_pages",
    });
  });

  it("preserves a remote tool name that itself contains a colon", () => {
    const name = buildMcpToolName("clx123abc", "namespace:sub_tool");
    expect(parseMcpToolName(name)).toEqual({
      integrationId: "clx123abc",
      remoteToolName: "namespace:sub_tool",
    });
  });

  it("returns null for a name with no mcp: prefix", () => {
    expect(parseMcpToolName("find_record")).toBeNull();
  });

  it("returns null for a malformed mcp: name with no second segment", () => {
    expect(parseMcpToolName("mcp:onlyoneseg")).toBeNull();
  });
});
