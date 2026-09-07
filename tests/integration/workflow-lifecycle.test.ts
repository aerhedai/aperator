import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import * as integrationService from "@/lib/integrations/integration-service";
import * as workflowService from "@/lib/workflows/workflow-service";

describe("workflow lifecycle", () => {
  const organisationId = "test-org-workflow-lifecycle";
  let classifierId: string;
  let handlerId: string;

  beforeEach(async () => {
    await prisma.workflowAgent.deleteMany({
      where: { workflow: { organisationId } },
    });
    await prisma.workflow.deleteMany({ where: { organisationId } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.customEntityRecord.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.customEntityType.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });

    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Lifecycle Org",
      },
    });
    const classifier = await prisma.agent.create({
      data: {
        organisationId,
        name: "Classifier",
        description: "d",
        instructions: "i",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    classifierId = classifier.id;
    const handler = await prisma.agent.create({
      data: {
        organisationId,
        name: "Handler",
        description: "d",
        instructions: "i",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "HARNESS",
        pipelineKey: "acknowledge_reply",
      },
    });
    handlerId = handler.id;
  });

  afterAll(async () => {
    await prisma.workflowAgent.deleteMany({
      where: { workflow: { organisationId } },
    });
    await prisma.workflow.deleteMany({ where: { organisationId } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.customEntityRecord.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.customEntityType.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("creates new workflows as CUSTOM and DRAFT, never live on creation", async () => {
    const workflow = await workflowService.createWorkflow(organisationId, {
      name: "Invoice Processing",
      description: "Handles inbound invoices.",
      trigger: "EMAIL",
    });

    expect(workflow).toMatchObject({
      source: "CUSTOM",
      status: "DRAFT",
      templateKey: null,
    });
  });

  it("refuses to activate a workflow with no classifier or handler", async () => {
    const workflow = await prisma.workflow.create({
      data: {
        organisationId,
        name: "Empty",
        description: "d",
        trigger: "EMAIL",
        source: "CUSTOM",
        status: "DRAFT",
      },
    });

    await expect(
      workflowService.activateWorkflow(organisationId, workflow.id),
    ).rejects.toThrow(/classifier and at least one handler/);
  });

  it("activates a fully-configured workflow and deactivates whatever else held that trigger", async () => {
    const alreadyActive = await prisma.workflow.create({
      data: {
        organisationId,
        name: "Email Handling",
        description: "d",
        trigger: "EMAIL",
        source: "TEMPLATE",
        templateKey: "email_handling",
        status: "ACTIVE",
      },
    });

    const custom = await prisma.workflow.create({
      data: {
        organisationId,
        name: "Custom Email Flow",
        description: "d",
        trigger: "EMAIL",
        source: "CUSTOM",
        status: "DRAFT",
      },
    });
    await prisma.workflowAgent.createMany({
      data: [
        { workflowId: custom.id, agentId: classifierId, role: "CLASSIFIER" },
        { workflowId: custom.id, agentId: handlerId, role: "HANDLER" },
      ],
    });

    await workflowService.activateWorkflow(organisationId, custom.id);

    const refreshedCustom = await prisma.workflow.findUniqueOrThrow({
      where: { id: custom.id },
    });
    const refreshedOld = await prisma.workflow.findUniqueOrThrow({
      where: { id: alreadyActive.id },
    });
    expect(refreshedCustom.status).toBe("ACTIVE");
    expect(refreshedOld.status).toBe("DRAFT");
  });

  it("deactivates a workflow back to draft", async () => {
    const workflow = await prisma.workflow.create({
      data: {
        organisationId,
        name: "Live One",
        description: "d",
        trigger: "EMAIL",
        source: "CUSTOM",
        status: "ACTIVE",
      },
    });

    await workflowService.deactivateWorkflow(organisationId, workflow.id);

    const refreshed = await prisma.workflow.findUniqueOrThrow({
      where: { id: workflow.id },
    });
    expect(refreshed.status).toBe("DRAFT");
  });

  it("refuses to create a WEBHOOK workflow with no bound account — there's no generic webhook URL to fall back to", async () => {
    await expect(
      workflowService.createWorkflow(organisationId, {
        name: "Website Form",
        description: "d",
        trigger: "WEBHOOK",
        triggerIntegrationId: null,
      }),
    ).rejects.toThrow(/must be bound to a specific connected account/);
  });

  it("refuses to bind a workflow to an account of the wrong provider for its trigger", async () => {
    const { integration: webhookAccount } =
      await integrationService.connectWebhookAccount(organisationId, "Form");

    await expect(
      workflowService.createWorkflow(organisationId, {
        name: "Wrongly Bound",
        description: "d",
        trigger: "EMAIL",
        triggerIntegrationId: webhookAccount.id,
      }),
    ).rejects.toThrow(/must be bound to a gmail or outlook account/i);
  });

  it("accepts an EMAIL workflow bound to an Outlook account, not just Gmail", async () => {
    const outlookAccount = await integrationService.connectOAuthAccount(
      organisationId,
      "outlook",
      {
        accountName: "sales@fswd.test",
        config: {},
        credentials: { accessToken: "a", refreshToken: "r" },
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );

    const workflow = await workflowService.createWorkflow(organisationId, {
      name: "Outlook Bound",
      description: "d",
      trigger: "EMAIL",
      triggerIntegrationId: outlookAccount.id,
    });

    expect(workflow.triggerIntegrationId).toBe(outlookAccount.id);
  });

  it("two workflows on the same trigger but different bound accounts can both be active at once", async () => {
    const { integration: accountA } =
      await integrationService.connectWebhookAccount(organisationId, "A");
    const { integration: accountB } =
      await integrationService.connectWebhookAccount(organisationId, "B");

    const workflowA = await workflowService.createWorkflow(organisationId, {
      name: "Workflow A",
      description: "d",
      trigger: "WEBHOOK",
      triggerIntegrationId: accountA.id,
    });
    await workflowService.addMember(
      organisationId,
      workflowA.id,
      classifierId,
      "CLASSIFIER",
    );
    await workflowService.addMember(
      organisationId,
      workflowA.id,
      handlerId,
      "HANDLER",
    );

    const workflowB = await workflowService.createWorkflow(organisationId, {
      name: "Workflow B",
      description: "d",
      trigger: "WEBHOOK",
      triggerIntegrationId: accountB.id,
    });
    await workflowService.addMember(
      organisationId,
      workflowB.id,
      classifierId,
      "CLASSIFIER",
    );
    await workflowService.addMember(
      organisationId,
      workflowB.id,
      handlerId,
      "HANDLER",
    );

    await workflowService.activateWorkflow(organisationId, workflowA.id);
    await workflowService.activateWorkflow(organisationId, workflowB.id);

    const refreshedA = await prisma.workflow.findUniqueOrThrow({
      where: { id: workflowA.id },
    });
    const refreshedB = await prisma.workflow.findUniqueOrThrow({
      where: { id: workflowB.id },
    });
    expect(refreshedA.status).toBe("ACTIVE");
    expect(refreshedB.status).toBe("ACTIVE");
  });

  it("activating a second workflow on the same account deactivates the first", async () => {
    const { integration: account } =
      await integrationService.connectWebhookAccount(organisationId, "Shared");

    const first = await workflowService.createWorkflow(organisationId, {
      name: "First",
      description: "d",
      trigger: "WEBHOOK",
      triggerIntegrationId: account.id,
    });
    await workflowService.addMember(
      organisationId,
      first.id,
      classifierId,
      "CLASSIFIER",
    );
    await workflowService.addMember(
      organisationId,
      first.id,
      handlerId,
      "HANDLER",
    );
    await workflowService.activateWorkflow(organisationId, first.id);

    const second = await workflowService.createWorkflow(organisationId, {
      name: "Second",
      description: "d",
      trigger: "WEBHOOK",
      triggerIntegrationId: account.id,
    });
    await workflowService.addMember(
      organisationId,
      second.id,
      classifierId,
      "CLASSIFIER",
    );
    await workflowService.addMember(
      organisationId,
      second.id,
      handlerId,
      "HANDLER",
    );
    await workflowService.activateWorkflow(organisationId, second.id);

    const refreshedFirst = await prisma.workflow.findUniqueOrThrow({
      where: { id: first.id },
    });
    const refreshedSecond = await prisma.workflow.findUniqueOrThrow({
      where: { id: second.id },
    });
    expect(refreshedFirst.status).toBe("DRAFT");
    expect(refreshedSecond.status).toBe("ACTIVE");
  });

  it("removes a member's workflow role without touching the agent itself", async () => {
    const workflow = await workflowService.createWorkflow(organisationId, {
      name: "Removable Member",
      description: "d",
      trigger: "EMAIL",
    });
    await workflowService.addMember(
      organisationId,
      workflow.id,
      handlerId,
      "HANDLER",
    );

    const removed = await workflowService.removeMember(
      organisationId,
      workflow.id,
      handlerId,
    );

    expect(removed).toBe(true);
    const reloaded = await workflowService.getWorkflow(
      organisationId,
      workflow.id,
    );
    expect(reloaded?.members).toHaveLength(0);
    const agentStillExists = await prisma.agent.findUnique({
      where: { id: handlerId },
    });
    expect(agentStillExists).not.toBeNull();
  });

  it("deletes a workflow with no members assigned", async () => {
    const workflow = await workflowService.createWorkflow(organisationId, {
      name: "Empty, Deletable",
      description: "d",
      trigger: "EMAIL",
    });

    const deleted = await workflowService.deleteWorkflow(
      organisationId,
      workflow.id,
    );

    expect(deleted).toBe(true);
    const reloaded = await prisma.workflow.findUnique({
      where: { id: workflow.id },
    });
    expect(reloaded).toBeNull();
  });

  it("refuses to delete a workflow that still has agents assigned", async () => {
    const workflow = await workflowService.createWorkflow(organisationId, {
      name: "Has Members",
      description: "d",
      trigger: "EMAIL",
    });
    await workflowService.addMember(
      organisationId,
      workflow.id,
      handlerId,
      "HANDLER",
    );

    await expect(
      workflowService.deleteWorkflow(organisationId, workflow.id),
    ).rejects.toThrow(/still has agents assigned/);

    const reloaded = await prisma.workflow.findUnique({
      where: { id: workflow.id },
    });
    expect(reloaded).not.toBeNull();
  });

  it("does not remove a member from a workflow belonging to a different organisation", async () => {
    const otherOrganisationId = "test-org-workflow-lifecycle-other";
    await prisma.organisation.create({
      data: {
        id: otherOrganisationId,
        clerkOrgId: otherOrganisationId,
        name: "Other Org",
      },
    });

    const workflow = await workflowService.createWorkflow(organisationId, {
      name: "Cross-Org Guard",
      description: "d",
      trigger: "EMAIL",
    });
    await workflowService.addMember(
      organisationId,
      workflow.id,
      handlerId,
      "HANDLER",
    );

    const removed = await workflowService.removeMember(
      otherOrganisationId,
      workflow.id,
      handlerId,
    );

    expect(removed).toBe(false);
    const reloaded = await workflowService.getWorkflow(
      organisationId,
      workflow.id,
    );
    expect(reloaded?.members).toHaveLength(1);

    await prisma.customEntityRecord.deleteMany({
      where: { organisationId: otherOrganisationId },
    });
    await prisma.customEntityType.deleteMany({
      where: { organisationId: otherOrganisationId },
    });
    await prisma.organisation.deleteMany({
      where: { id: otherOrganisationId },
    });
  });
});
