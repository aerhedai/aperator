import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AIProvider } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";
import type { Agent } from "@/lib/generated/prisma/client";
import { runHarnessPipeline } from "@/lib/harness/run-harness-pipeline";

// No LLM calls are ever expected from this pipeline — a provider that
// throws if called is itself part of what several of these tests prove.
const neverCallProvider: AIProvider = {
  generateResponse: async () => {
    throw new Error("entity_status_signal must never call the AI provider");
  },
};

describe("entity_status_signal pipeline", () => {
  const organisationId = "test-org-entity-signal";
  let jobEntityTypeId: string;

  async function createAgent(overrides: {
    pipelineConfig: unknown;
    tools?: string[];
  }): Promise<Agent> {
    const agent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Job Signal Agent",
        description: "Tracks job status signals.",
        instructions: "n/a — deterministic pipeline.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "HARNESS",
        pipelineKey: "entity_status_signal",
        pipelineConfig: overrides.pipelineConfig as never,
      },
    });
    const tools = overrides.tools ?? [
      "find_record",
      "create_record",
      "update_record",
      "GOOGLE_DRIVE_CREATE_FOLDER",
      "GMAIL_SEND_EMAIL",
    ];
    await prisma.agentTool.createMany({
      data: tools.map((toolName) => ({ agentId: agent.id, toolName })),
    });
    return agent;
  }

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Entity Signal Test Org",
        currency: "GBP",
      },
    });
    const jobType = await prisma.customEntityType.create({
      data: {
        organisationId,
        name: "Job",
        fields: [
          { name: "jobId", description: "the job id" },
          { name: "status", description: "the job status" },
        ],
      },
    });
    jobEntityTypeId = jobType.id;
  });

  afterAll(async () => {
    const runs = await prisma.agentRun.findMany({
      where: { organisationId },
      select: { id: true },
    });
    const runIds = runs.map((r) => r.id);
    await prisma.approval.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.toolCall.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.runStep.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.agentRun.deleteMany({ where: { organisationId } });
    await prisma.customEntityRecord.deleteMany({
      where: { organisationId, entityTypeId: jobEntityTypeId },
    });
    await prisma.customEntityType.deleteMany({ where: { organisationId } });
    await prisma.agentTool.deleteMany({
      where: { agent: { organisationId } },
    });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("creates a record on first sight of a key, with no configured transition it just completes", async () => {
    const agent = await createAgent({
      pipelineConfig: {
        recordType: "Job",
        keyField: "jobId",
        statusField: "status",
        transitions: {},
      },
    });

    const result = await runHarnessPipeline(
      agent,
      JSON.stringify({ jobId: "1001", status: "New" }),
      neverCallProvider,
    );

    expect(result.status).toBe("COMPLETED");

    const record = await prisma.customEntityRecord.findFirst({
      where: { organisationId, entityTypeId: jobEntityTypeId },
    });
    expect(record?.data).toMatchObject({ jobId: "1001", status: "New" });
  });

  it("updates the same record rather than duplicating it on a second signal for the same key", async () => {
    const agent = await createAgent({
      pipelineConfig: {
        recordType: "Job",
        keyField: "jobId",
        statusField: "status",
        transitions: {},
      },
    });

    await runHarnessPipeline(
      agent,
      JSON.stringify({ jobId: "1002", status: "New", client: "Customer ABC" }),
      neverCallProvider,
    );
    await runHarnessPipeline(
      agent,
      JSON.stringify({ jobId: "1002", status: "Approved" }),
      neverCallProvider,
    );

    const records = await prisma.customEntityRecord.findMany({
      where: { organisationId, entityTypeId: jobEntityTypeId },
    });
    const matching = records.filter(
      (r) => (r.data as { jobId?: string }).jobId === "1002",
    );
    expect(matching).toHaveLength(1);
    // The earlier "client" field survives the merge, even though the
    // second signal never repeated it.
    expect(matching[0]?.data).toMatchObject({
      jobId: "1002",
      status: "Approved",
      client: "Customer ABC",
    });
  });

  it("fails clearly when the input isn't a JSON object", async () => {
    const agent = await createAgent({
      pipelineConfig: {
        recordType: "Job",
        keyField: "jobId",
        statusField: "status",
        transitions: {},
      },
    });

    const result = await runHarnessPipeline(
      agent,
      "not json",
      neverCallProvider,
    );

    expect(result.status).toBe("FAILED");
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { steps: true },
    });
    expect(run.steps.at(-1)).toMatchObject({
      stepType: "RUN_FAILED",
      detail: expect.stringContaining("structured JSON signal"),
    });
  });

  it("fails clearly when pipelineConfig is missing or invalid", async () => {
    const agent = await createAgent({ pipelineConfig: {} });

    const result = await runHarnessPipeline(
      agent,
      JSON.stringify({ jobId: "1003", status: "New" }),
      neverCallProvider,
    );

    expect(result.status).toBe("FAILED");
  });

  it("fails clearly when the signal is missing the configured key or status field", async () => {
    const agent = await createAgent({
      pipelineConfig: {
        recordType: "Job",
        keyField: "jobId",
        statusField: "status",
        transitions: {},
      },
    });

    const result = await runHarnessPipeline(
      agent,
      JSON.stringify({ status: "New" }),
      neverCallProvider,
    );

    expect(result.status).toBe("FAILED");
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { steps: true },
    });
    expect(run.steps.at(-1)).toMatchObject({
      detail: expect.stringContaining("jobId"),
    });
  });

  it("attempts folder creation for a configured transition, and fails clearly when storage isn't connected", async () => {
    const agent = await createAgent({
      pipelineConfig: {
        recordType: "Job",
        keyField: "jobId",
        statusField: "status",
        transitions: {
          Approved: {
            createFolders: {
              provider: "google-drive",
              rootFolder: "{jobId}",
              subfolders: ["Client correspondence", "Calculation", "Quotation"],
            },
          },
        },
      },
    });

    const result = await runHarnessPipeline(
      agent,
      JSON.stringify({ jobId: "1004", status: "Approved" }),
      neverCallProvider,
    );

    expect(result.status).toBe("FAILED");
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { steps: { include: { toolCall: true } } },
    });
    const folderCall = run.steps.find(
      (s) => s.toolCall?.toolName === "GOOGLE_DRIVE_CREATE_FOLDER",
    );
    expect(folderCall?.toolCall?.status).toBe("FAILED");
    expect(folderCall?.toolCall?.error).toMatch(
      /google drive is not connected/i,
    );
  });

  it("proposes send_email for approval when the transition configures it", async () => {
    const agent = await createAgent({
      pipelineConfig: {
        recordType: "Job",
        keyField: "jobId",
        statusField: "status",
        transitions: {
          Approved: {
            sendEmail: {
              toField: "customerEmail",
              subjectTemplate: "Job {jobId} received",
              bodyTemplate: "Thanks — we've received job {jobId}.",
            },
          },
        },
      },
    });

    const result = await runHarnessPipeline(
      agent,
      JSON.stringify({
        jobId: "1005",
        status: "Approved",
        customerEmail: "buyer@customer-abc.test",
      }),
      neverCallProvider,
    );

    expect(result.status).toBe("WAITING_FOR_APPROVAL");
    const approval = await prisma.approval.findFirst({
      where: { agentRunId: result.runId },
    });
    expect(approval).toMatchObject({
      status: "PENDING",
      requestedAction: "GMAIL_SEND_EMAIL",
      proposedInput: {
        to: "buyer@customer-abc.test",
        subject: "Job 1005 received",
      },
    });
  });

  it("fails clearly when the record has no valid email for the configured toField", async () => {
    const agent = await createAgent({
      pipelineConfig: {
        recordType: "Job",
        keyField: "jobId",
        statusField: "status",
        transitions: {
          Approved: {
            sendEmail: {
              toField: "customerEmail",
              subjectTemplate: "Job {jobId} received",
              bodyTemplate: "Thanks.",
            },
          },
        },
      },
    });

    const result = await runHarnessPipeline(
      agent,
      JSON.stringify({ jobId: "1006", status: "Approved" }),
      neverCallProvider,
    );

    expect(result.status).toBe("FAILED");
  });

  it("respects per-agent tool restriction — a disallowed tool is refused, not silently used", async () => {
    const agent = await createAgent({
      pipelineConfig: {
        recordType: "Job",
        keyField: "jobId",
        statusField: "status",
        transitions: {},
      },
      tools: ["find_record"], // missing create_record
    });

    const result = await runHarnessPipeline(
      agent,
      JSON.stringify({ jobId: "1007", status: "New" }),
      neverCallProvider,
    );

    expect(result.status).toBe("FAILED");
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { steps: { include: { toolCall: true } } },
    });
    const createCall = run.steps.find(
      (s) => s.toolCall?.toolName === "create_record",
    );
    expect(createCall?.toolCall?.error).toMatch(/does not have access/i);
  });
});
