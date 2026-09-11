import { describe, expect, it } from "vitest";

import { getWorkflowWarnings } from "@/lib/workflows/workflow-health";

function workflow(
  overrides: Partial<Parameters<typeof getWorkflowWarnings>[0]> = {},
) {
  return {
    status: "ACTIVE" as const,
    trigger: "EMAIL" as const,
    triggerIntegrationId: null,
    members: [
      { role: "CLASSIFIER" as const, agent: { status: "ACTIVE" as const } },
      { role: "HANDLER" as const, agent: { status: "ACTIVE" as const } },
    ],
    ...overrides,
  };
}

describe("getWorkflowWarnings", () => {
  it("returns no warnings for a DRAFT workflow, however misconfigured", () => {
    const warnings = getWorkflowWarnings(
      workflow({ status: "DRAFT", members: [] }),
      new Set(),
    );
    expect(warnings).toEqual([]);
  });

  it("returns no warnings for a fully-configured ACTIVE workflow with a connected email account", () => {
    const warnings = getWorkflowWarnings(workflow(), new Set(["gmail"]));
    expect(warnings).toEqual([]);
  });

  it("warns when an ACTIVE workflow has no classifier", () => {
    const warnings = getWorkflowWarnings(
      workflow({
        members: [{ role: "HANDLER", agent: { status: "ACTIVE" } }],
      }),
      new Set(["gmail"]),
    );
    expect(warnings).toEqual([
      "No classifier is assigned — this department can never route anything.",
    ]);
  });

  it("warns when an ACTIVE workflow has handlers but none of them are ACTIVE", () => {
    const warnings = getWorkflowWarnings(
      workflow({
        members: [
          { role: "CLASSIFIER", agent: { status: "ACTIVE" } },
          { role: "HANDLER", agent: { status: "ARCHIVED" } },
        ],
      }),
      new Set(["gmail"]),
    );
    expect(warnings).toEqual([
      "No active handler worker — even a matched message has nothing to run.",
    ]);
  });

  it("warns on an org-default EMAIL workflow when no Gmail or Outlook account is connected — the exact gap that left a real workflow silently inert", () => {
    const warnings = getWorkflowWarnings(workflow(), new Set(["google-drive"]));
    expect(warnings).toEqual([
      "No Gmail or Outlook account is connected — this department can never receive real email.",
    ]);
  });

  it("does not warn about a missing email account when the workflow is bound to a specific account", () => {
    const warnings = getWorkflowWarnings(
      workflow({ triggerIntegrationId: "integration-1" }),
      new Set(),
    );
    expect(warnings).toEqual([]);
  });

  it("accepts an Outlook account as satisfying the EMAIL trigger requirement, not just Gmail", () => {
    const warnings = getWorkflowWarnings(workflow(), new Set(["outlook"]));
    expect(warnings).toEqual([]);
  });

  it("never checks for an email account on a WEBHOOK workflow", () => {
    const warnings = getWorkflowWarnings(
      workflow({ trigger: "WEBHOOK", triggerIntegrationId: null }),
      new Set(),
    );
    expect(warnings).toEqual([]);
  });

  it("reports multiple independent problems at once", () => {
    const warnings = getWorkflowWarnings(workflow({ members: [] }), new Set());
    expect(warnings).toHaveLength(3);
  });
});
