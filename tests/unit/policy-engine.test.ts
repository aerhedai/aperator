import { describe, expect, it, vi } from "vitest";

import * as integrationService from "@/lib/integrations/integration-service";
import { buildMcpToolName } from "@/lib/integrations/mcp/tool-naming";
import {
  evaluatePolicy,
  requiresApprovalBeforeExecution,
} from "@/lib/policies/policy-engine";

const ORG_ID = "test-org";

describe("requiresApprovalBeforeExecution", () => {
  it("requires approval for GMAIL_SEND_EMAIL", async () => {
    expect(
      await requiresApprovalBeforeExecution("GMAIL_SEND_EMAIL", ORG_ID),
    ).toBe(true);
  });

  it("requires approval for OUTLOOK_SEND_EMAIL", async () => {
    expect(
      await requiresApprovalBeforeExecution("OUTLOOK_SEND_EMAIL", ORG_ID),
    ).toBe(true);
  });

  it("requires approval for OUTLOOK_CREATE_CALENDAR_EVENT", async () => {
    expect(
      await requiresApprovalBeforeExecution(
        "OUTLOOK_CREATE_CALENDAR_EVENT",
        ORG_ID,
      ),
    ).toBe(true);
  });

  it("does not require approval for SLACK_POST_MESSAGE or TEAMS_POST_MESSAGE", async () => {
    expect(
      await requiresApprovalBeforeExecution("SLACK_POST_MESSAGE", ORG_ID),
    ).toBe(false);
    expect(
      await requiresApprovalBeforeExecution("TEAMS_POST_MESSAGE", ORG_ID),
    ).toBe(false);
  });

  it("does not require approval for read-only built-in tools", async () => {
    expect(await requiresApprovalBeforeExecution("find_record", ORG_ID)).toBe(
      false,
    );
    expect(
      await requiresApprovalBeforeExecution("search_records", ORG_ID),
    ).toBe(false);
    expect(
      await requiresApprovalBeforeExecution(
        "OUTLOOK_CHECK_CALENDAR_AVAILABILITY",
        ORG_ID,
      ),
    ).toBe(false);
  });

  it("does not require approval for an mcp tool marked readOnlyHint: true", async () => {
    vi.spyOn(integrationService, "findMcpTool").mockResolvedValueOnce({
      name: "search",
      description: "",
      inputSchema: { type: "object" },
      readOnlyHint: true,
    });

    expect(
      await requiresApprovalBeforeExecution(
        buildMcpToolName("int1", "search"),
        ORG_ID,
      ),
    ).toBe(false);
  });

  it("requires approval for an mcp tool with no readOnlyHint at all", async () => {
    vi.spyOn(integrationService, "findMcpTool").mockResolvedValueOnce({
      name: "delete_page",
      description: "",
      inputSchema: { type: "object" },
      readOnlyHint: null,
    });

    expect(
      await requiresApprovalBeforeExecution(
        buildMcpToolName("int1", "delete_page"),
        ORG_ID,
      ),
    ).toBe(true);
  });

  it("requires approval for an mcp tool whose connection can no longer be found (fail closed)", async () => {
    vi.spyOn(integrationService, "findMcpTool").mockResolvedValueOnce(null);

    expect(
      await requiresApprovalBeforeExecution(
        buildMcpToolName("gone", "whatever"),
        ORG_ID,
      ),
    ).toBe(true);
  });
});

describe("evaluatePolicy", () => {
  it("allows any tool by default — no post-execution rules are active", () => {
    const result = evaluatePolicy({
      toolName: "calculate_quote",
      toolOutput: { total: 27_000 },
    });

    expect(result.decision).toBe("ALLOW");
  });

  it("allows GMAIL_SEND_EMAIL's own output too — its gate is pre-execution, not output-based", () => {
    const result = evaluatePolicy({
      toolName: "GMAIL_SEND_EMAIL",
      toolOutput: { sent: true },
    });

    expect(result.decision).toBe("ALLOW");
  });
});
