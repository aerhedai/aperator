import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import * as workflowTemplateService from "@/lib/workflows/workflow-template-service";

// Proves the actual contract WorkflowTemplate exists for: installing one
// produces a complete, immediately-usable department (unlike a lone
// AgentTemplate, which stays DRAFT for review) — a real, ACTIVE Workflow
// with an ACTIVE classifier and ACTIVE handler(s), wired together, plus
// whichever Record Types its handlers actually need and nothing more.

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
        "Customer Enquiries",
        "Meeting Scheduling",
        "Lead Intake",
        "Document Requests",
        "Team Escalation",
        "Order & Booking Confirmation",
      ]),
    );
    expect(templates.every((t) => t.builtIn)).toBe(true);
  });

  it("installs a single-handler department as one real, active workflow", async () => {
    const templates =
      await workflowTemplateService.listWorkflowTemplates(organisationId);
    const template = templates.find((t) => t.name === "Meeting Scheduling");
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
      name: "Meeting Scheduling",
      trigger: "MANUAL",
      status: "ACTIVE",
      source: "TEMPLATE",
    });
    expect(workflow!.members).toHaveLength(2);

    const classifierMember = workflow!.members.find(
      (m) => m.role === "CLASSIFIER",
    );
    const handlerMember = workflow!.members.find((m) => m.role === "HANDLER");
    expect(classifierMember?.agent).toMatchObject({
      status: "ACTIVE",
      chatInvokable: false,
    });
    expect(handlerMember?.agent).toMatchObject({
      status: "ACTIVE",
      name: "Meeting Scheduler",
      executionMode: "LOOP",
    });
  });

  it("installs a multi-handler department with all handlers wired and active", async () => {
    const templates =
      await workflowTemplateService.listWorkflowTemplates(organisationId);
    const template = templates.find((t) => t.name === "Customer Enquiries");
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
    expect(workflow!.members).toHaveLength(4);
    const handlerNames = workflow!.members
      .filter((m) => m.role === "HANDLER")
      .map((m) => m.agent.name)
      .sort();
    expect(handlerNames).toEqual([
      "Complaints Handler",
      "General Inquiry Handler",
      "Quote Handler",
    ]);
    expect(workflow!.members.every((m) => m.agent.status === "ACTIVE")).toBe(
      true,
    );

    const recordTypeNames = (
      await prisma.customEntityType.findMany({ where: { organisationId } })
    ).map((t) => t.name);
    expect(recordTypeNames.sort()).toEqual(["Customer", "Product"]);
  });

  it("seeds only the record types this department's handlers actually need", async () => {
    const templates =
      await workflowTemplateService.listWorkflowTemplates(organisationId);
    const template = templates.find((t) => t.name === "Lead Intake");
    if (!template) throw new Error("fixture template not found");

    const result = await workflowTemplateService.installWorkflowTemplate(
      organisationId,
      template.id,
    );
    expect(result.ok).toBe(true);

    const recordTypeNames = (
      await prisma.customEntityType.findMany({ where: { organisationId } })
    ).map((t) => t.name);
    // Lead only — installing this department must not also hand the
    // business Product/Customer/Booking types it never asked for.
    expect(recordTypeNames).toEqual(["Lead"]);
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
});
