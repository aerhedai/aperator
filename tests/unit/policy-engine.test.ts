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

  it("requires approval for the newer consequential tools (calendar update/cancel, Drive/SharePoint delete/share)", async () => {
    for (const toolName of [
      "OUTLOOK_UPDATE_CALENDAR_EVENT",
      "OUTLOOK_CANCEL_CALENDAR_EVENT",
      "GOOGLE_DRIVE_DELETE_FILE",
      "GOOGLE_DRIVE_SHARE_FILE",
      "SHAREPOINT_DELETE_FILE",
    ]) {
      expect(await requiresApprovalBeforeExecution(toolName, ORG_ID)).toBe(
        true,
      );
    }
  });

  it("does not require approval for the newer read-only or low-consequence tools", async () => {
    for (const toolName of [
      "GMAIL_SEARCH_INBOX",
      "GMAIL_ARCHIVE_MESSAGE",
      "GMAIL_CREATE_DRAFT",
      "GMAIL_APPLY_LABEL",
      "OUTLOOK_SEARCH_INBOX",
      "OUTLOOK_ARCHIVE_MESSAGE",
      "OUTLOOK_CREATE_DRAFT",
      "OUTLOOK_FIND_CONTACT",
      "OUTLOOK_CREATE_CONTACT",
      "OUTLOOK_LIST_CALENDAR_EVENTS",
      "TEAMS_LIST_CHANNELS",
      "TEAMS_READ_CHANNEL_MESSAGES",
      "GOOGLE_DRIVE_SEARCH_FILES",
      "GOOGLE_DRIVE_LIST_FOLDER",
      "GOOGLE_DRIVE_GET_FILE",
      "SHAREPOINT_SEARCH_FILES",
      "SHAREPOINT_LIST_FOLDER",
      "SHAREPOINT_GET_FILE",
      "SLACK_SEARCH_MESSAGES",
      "SLACK_LIST_CHANNELS",
      "SLACK_READ_CHANNEL_HISTORY",
      "SLACK_GET_USER_INFO",
    ]) {
      expect(await requiresApprovalBeforeExecution(toolName, ORG_ID)).toBe(
        false,
      );
    }
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
