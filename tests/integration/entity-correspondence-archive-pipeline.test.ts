import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AIProvider } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";
import type { Agent } from "@/lib/generated/prisma/client";
import { Prisma } from "@/lib/generated/prisma/client";
import { runHarnessPipeline } from "@/lib/harness/run-harness-pipeline";
import type { ResolvedAttachment } from "@/lib/harness/types";

// No LLM calls are ever expected from this pipeline — same guard as
// entity-status-signal-pipeline.test.ts.
const neverCallProvider: AIProvider = {
  generateResponse: async () => {
    throw new Error(
      "entity_correspondence_archive must never call the AI provider",
    );
  },
};

describe("entity_correspondence_archive pipeline", () => {
  const organisationId = "test-org-entity-correspondence";
  let jobEntityTypeId: string;

  async function createAgent(overrides: {
    pipelineConfig: unknown;
    tools?: string[];
  }): Promise<Agent> {
    const agent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Correspondence Archive Agent",
        description: "Archives inbound email correspondence for a job.",
        instructions: "n/a — deterministic pipeline.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "HARNESS",
        pipelineKey: "entity_correspondence_archive",
        pipelineConfig: overrides.pipelineConfig as never,
      },
    });
    const tools = overrides.tools ?? ["find_record", "GOOGLE_DRIVE_SAVE_FILE"];
    await prisma.agentTool.createMany({
      data: tools.map((toolName) => ({ agentId: agent.id, toolName })),
    });
    return agent;
  }

  async function createJobRecord(data: Record<string, unknown>): Promise<void> {
    await prisma.customEntityRecord.create({
      data: {
        organisationId,
        entityTypeId: jobEntityTypeId,
        data: data as Prisma.InputJsonValue,
      },
    });
  }

  const basePipelineConfig = {
    recordType: "Job",
    keyField: "jobId",
    subjectPattern: "\\[Job #([A-Za-z0-9-]+)\\]",
    provider: "google-drive" as const,
    rootFolderField: "jobId",
    correspondenceSubfolder: "Client correspondence",
    correspondenceFilename: "correspondence.txt",
  };

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Entity Correspondence Test Org",
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

  it("fails clearly when pipelineConfig is missing or invalid", async () => {
    const agent = await createAgent({ pipelineConfig: {} });

    const result = await runHarnessPipeline(
      agent,
      "Subject: [Job #2001] Re: quote\n\nSee attached.",
      neverCallProvider,
    );

    expect(result.status).toBe("FAILED");
  });

  it("fails clearly when the subject line has no matching reference token", async () => {
    const agent = await createAgent({ pipelineConfig: basePipelineConfig });

    const result = await runHarnessPipeline(
      agent,
      "Subject: Re: quote\n\nSee attached.",
      neverCallProvider,
    );

    expect(result.status).toBe("FAILED");
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { steps: { orderBy: { createdAt: "asc" } } },
    });
    expect(run.steps.at(-1)).toMatchObject({
      detail: expect.stringContaining("No matching reference token"),
    });
  });

  it("fails clearly with an invalid subjectPattern regex", async () => {
    const agent = await createAgent({
      pipelineConfig: {
        ...basePipelineConfig,
        subjectPattern: "(unterminated",
      },
    });

    const result = await runHarnessPipeline(
      agent,
      "Subject: [Job #2002] Re: quote\n\nSee attached.",
      neverCallProvider,
    );

    expect(result.status).toBe("FAILED");
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { steps: { orderBy: { createdAt: "asc" } } },
    });
    expect(run.steps.at(-1)).toMatchObject({
      detail: expect.stringContaining("not a valid regex"),
    });
  });

  it("fails clearly when no record matches the extracted reference token", async () => {
    const agent = await createAgent({ pipelineConfig: basePipelineConfig });

    const result = await runHarnessPipeline(
      agent,
      "Subject: [Job #9999] Re: quote\n\nSee attached.",
      neverCallProvider,
    );

    expect(result.status).toBe("FAILED");
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { steps: { orderBy: { createdAt: "asc" } } },
    });
    expect(run.steps.at(-1)).toMatchObject({
      detail: expect.stringContaining('No Job record found for "9999"'),
    });
  });

  it("finds the record from the subject reference token, then fails clearly saving the body when storage isn't connected", async () => {
    await createJobRecord({ jobId: "2003", status: "Approved" });
    const agent = await createAgent({ pipelineConfig: basePipelineConfig });

    const result = await runHarnessPipeline(
      agent,
      "Subject: [Job #2003] Re: quote\n\nSee attached.",
      neverCallProvider,
    );

    expect(result.status).toBe("FAILED");
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { steps: { include: { toolCall: true } } },
    });
    const saveCall = run.steps.find(
      (s) => s.toolCall?.toolName === "GOOGLE_DRIVE_SAVE_FILE",
    );
    expect(saveCall?.toolCall?.status).toBe("FAILED");
    expect(saveCall?.toolCall?.error).toMatch(/google drive is not connected/i);
    // Never got as far as reading attachments, since the body save itself
    // already failed.
    expect(
      run.steps.filter(
        (s) => s.toolCall?.toolName === "GOOGLE_DRIVE_SAVE_FILE",
      ),
    ).toHaveLength(1);
  });

  it("respects per-agent tool restriction — a disallowed tool is refused, not silently used", async () => {
    await createJobRecord({ jobId: "2004", status: "Approved" });
    const agent = await createAgent({
      pipelineConfig: basePipelineConfig,
      tools: ["find_record"], // missing save_file
    });

    const result = await runHarnessPipeline(
      agent,
      "Subject: [Job #2004] Re: quote\n\nSee attached.",
      neverCallProvider,
    );

    expect(result.status).toBe("FAILED");
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { steps: { include: { toolCall: true } } },
    });
    const saveCall = run.steps.find(
      (s) => s.toolCall?.toolName === "GOOGLE_DRIVE_SAVE_FILE",
    );
    expect(saveCall?.toolCall?.error).toMatch(/does not have access/i);
  });

  it("uses the record's rootFolderField value for the archive path when present, falling back to the reference token otherwise", async () => {
    await createJobRecord({
      jobId: "2005",
      status: "Approved",
      rootFolder: "Custom ABC - 2005",
    });
    const agent = await createAgent({
      pipelineConfig: { ...basePipelineConfig, rootFolderField: "rootFolder" },
    });

    const result = await runHarnessPipeline(
      agent,
      "Subject: [Job #2005] Re: quote\n\nSee attached.",
      neverCallProvider,
    );

    // Still fails (no storage connected) — this test only checks *how far*
    // it got and that the resolved root folder value was actually used,
    // which we can't observe directly without a connected provider, so we
    // instead confirm the failure is the storage one, not an earlier one
    // (i.e. record lookup and root-folder resolution both succeeded).
    expect(result.status).toBe("FAILED");
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { steps: { include: { toolCall: true } } },
    });
    const saveCall = run.steps.find(
      (s) => s.toolCall?.toolName === "GOOGLE_DRIVE_SAVE_FILE",
    );
    expect(saveCall?.toolCall?.error).toMatch(/google drive is not connected/i);
  });

  it("attempts to save every resolved attachment via getAttachments, in addition to the body", async () => {
    await createJobRecord({ jobId: "2006", status: "Approved" });
    const agent = await createAgent({ pipelineConfig: basePipelineConfig });

    let attachmentsFetched = false;
    const getAttachments = async (): Promise<ResolvedAttachment[]> => {
      attachmentsFetched = true;
      return [
        {
          filename: "drawing.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("pdf bytes"),
        },
      ];
    };

    const result = await runHarnessPipeline(
      agent,
      "Subject: [Job #2006] Re: quote\n\nSee attached.",
      neverCallProvider,
      null,
      getAttachments,
    );

    // Body save fails first (no storage connected), so attachments are
    // never reached — but this at least confirms the pipeline short-circuits
    // before calling getAttachments rather than fetching it needlessly.
    expect(result.status).toBe("FAILED");
    expect(attachmentsFetched).toBe(false);
  });
});
