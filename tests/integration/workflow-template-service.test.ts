import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import * as workflowTemplateService from "@/lib/workflows/workflow-template-service";

// Proves the actual contract WorkflowTemplate exists for: installing one
// produces a complete, immediately-usable department (unlike a lone
// AgentTemplate, which stays DRAFT for review) — a real, ACTIVE Workflow
// with an ACTIVE classifier and ACTIVE handlers, wired together, plus
// whichever Record Types its handlers actually need and nothing more.
//
// Every built-in department has exactly 2 handlers — a real classifier
// decision, never a rubber-stamp — so there's no single-handler case left
// to test here; that shape retired to built-in-templates.ts as a plain
// agent instead (see agent-spec-install.test.ts / template-service tests).

describe("workflow template service", () => {
  const organisationId = "test-org-workflow-templates";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Workflow Templates Test Org",
        currency: "GBP",
      },
    });
  });

  afterEach(async () => {
    const workflows = await prisma.workflow.findMany({
      where: { organisationId },
      select: { id: true },
    });
    await prisma.workflowAgent.deleteMany({
      where: { workflowId: { in: workflows.map((w) => w.id) } },
    });
    await prisma.workflow.deleteMany({ where: { organisationId } });
    await prisma.agentTool.deleteMany({ where: { agent: { organisationId } } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.customEntityRecord.deleteMany({ where: { organisationId } });
    await prisma.customEntityType.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
  });

  it("lists the built-in departments", async () => {
    const templates =
      await workflowTemplateService.listWorkflowTemplates(organisationId);
    const names = templates.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Sales & Enquiries",
        "Customer Support",
        "Scheduling & Bookings",
        "Document & Records",
        "People & Internal Requests",
      ]),
    );
    expect(templates.every((t) => t.builtIn)).toBe(true);
    expect(templates.every((t) => t.handlers.length >= 2)).toBe(true);
  });

  it("installs a department as one real, active workflow with both handlers wired", async () => {
    const templates =
      await workflowTemplateService.listWorkflowTemplates(organisationId);
    const template = templates.find((t) => t.name === "Scheduling & Bookings");
    if (!template) throw new Error("fixture template not found");

    const result = await workflowTemplateService.installWorkflowTemplate(
      organisationId,
      template.id,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const workflow = await prisma.workflow.findFirst({
      where: { id: result.workflowId },
      include: { members: { include: { agent: true } } },
    });
    expect(workflow).toMatchObject({
      name: "Scheduling & Bookings",
      trigger: "MANUAL",
      status: "ACTIVE",
      source: "TEMPLATE",
    });
    expect(workflow!.members).toHaveLength(3);

    const classifierMember = workflow!.members.find(
      (m) => m.role === "CLASSIFIER",
    );
    expect(classifierMember?.agent).toMatchObject({
      status: "ACTIVE",
      chatInvokable: false,
    });

    const handlerNames = workflow!.members
      .filter((m) => m.role === "HANDLER")
      .map((m) => m.agent.name)
      .sort();
    expect(handlerNames).toEqual(["Booking Coordinator", "Meeting Scheduler"]);
    expect(workflow!.members.every((m) => m.agent.status === "ACTIVE")).toBe(
      true,
    );
    // Both handlers here genuinely need multi-step tool judgment (check
    // availability then decide; look up then create-or-update then email)
    // — a fixed step programme's terminal `act` step can't express either.
    expect(
      workflow!.members
        .filter((m) => m.role === "HANDLER")
        .every((m) => m.agent.executionMode === "LOOP"),
    ).toBe(true);
  });

  it("installs a multi-handler department and seeds only its own record types", async () => {
    const templates =
      await workflowTemplateService.listWorkflowTemplates(organisationId);
    const template = templates.find((t) => t.name === "Customer Support");
    if (!template) throw new Error("fixture template not found");

    const result = await workflowTemplateService.installWorkflowTemplate(
      organisationId,
      template.id,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const workflow = await prisma.workflow.findFirst({
      where: { id: result.workflowId },
      include: { members: { include: { agent: true } } },
    });
    expect(workflow!.members).toHaveLength(3);
    const handlerNames = workflow!.members
      .filter((m) => m.role === "HANDLER")
      .map((m) => m.agent.name)
      .sort();
    expect(handlerNames).toEqual([
      "Complaints Handler",
      "General Inquiry Handler",
    ]);
    expect(workflow!.members.every((m) => m.agent.status === "ACTIVE")).toBe(
      true,
    );

    // Customer Support only needs Customer — not Product, Lead, Booking or
    // Invoice, which other departments bring in.
    const recordTypeNames = (
      await prisma.customEntityType.findMany({ where: { organisationId } })
    ).map((t) => t.name);
    expect(recordTypeNames).toEqual(["Customer"]);
  });

  it("seeds no record types for a department whose handlers don't need any", async () => {
    const templates =
      await workflowTemplateService.listWorkflowTemplates(organisationId);
    const template = templates.find(
      (t) => t.name === "People & Internal Requests",
    );
    if (!template) throw new Error("fixture template not found");

    const result = await workflowTemplateService.installWorkflowTemplate(
      organisationId,
      template.id,
    );
    expect(result.ok).toBe(true);

    const recordTypeNames = await prisma.customEntityType.findMany({
      where: { organisationId },
    });
    expect(recordTypeNames).toEqual([]);
  });

  it("returns a clear error for an unknown template id, creating nothing", async () => {
    const before = await prisma.agent.count({ where: { organisationId } });

    const result = await workflowTemplateService.installWorkflowTemplate(
      organisationId,
      "nonexistent-template-id",
    );
    expect(result).toEqual({ ok: false, error: "Template not found." });

    const after = await prisma.agent.count({ where: { organisationId } });
    expect(after).toBe(before);
  });

  it("prunes a built-in row whose name is no longer in code", async () => {
    await workflowTemplateService.listWorkflowTemplates(organisationId);
    await prisma.workflowTemplate.create({
      data: {
        organisationId: null,
        name: "Retired Department",
        description: "No longer shipped.",
        classifierInstructions: "n/a",
        handlers: [],
        recordTypes: [],
      },
    });

    await workflowTemplateService.seedBuiltInWorkflowTemplates();

    const stale = await prisma.workflowTemplate.findFirst({
      where: { organisationId: null, name: "Retired Department" },
    });
    expect(stale).toBeNull();
  });
});
