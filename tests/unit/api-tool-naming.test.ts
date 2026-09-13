import { describe, expect, it } from "vitest";

import {
  buildApiToolName,
  parseApiToolName,
} from "@/lib/integrations/api/tool-naming";

describe("api tool naming", () => {
  it("round-trips a connection id through build and parse", () => {
    const name = buildApiToolName("clabc123");
    expect(name).toBe("api__clabc123");
    expect(parseApiToolName(name)).toEqual({ integrationId: "clabc123" });
  });

  it("does not parse a name with the wrong prefix", () => {
    expect(parseApiToolName("mcp__clabc123")).toBeNull();
    expect(parseApiToolName("find_record")).toBeNull();
  });

  it("does not parse a name with an empty integration id", () => {
    expect(parseApiToolName("api__")).toBeNull();
  });
});
