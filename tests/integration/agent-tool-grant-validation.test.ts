import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import * as agentService from "@/lib/agents/agent-service";
import { prisma } from "@/lib/db/prisma";

const baseAgentInput = {
  name: "Test Agent",
  description: "A test agent.",
  instructions: "Do things.",
  model: "test-model",
  keywords: [] as string[],
  replySubjectTemplate: null,
  extractionFields: [] as never[],
  guardrailKeywords: [] as string[],
  actionIntegrationId: null,
  pipelineConfig: {} as Record<string, unknown>,
  executionMode: "LOOP" as const,
  pipelineKey: null,
};

describe("agent tool grant validation", () => {
  const organisationId = "test-org-grant-validation";

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Grant Validation Test Org",
      },
    });
  });

  afterAll(async () => {
    await prisma.agentTool.deleteMany({
      where: { agent: { organisationId } },
    });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.agentTool.deleteMany({
      where: { agent: { organisationId } },
    });
    await prisma.agent.deleteMany({ where: { organisationId } });
    // The brief's test bodies create an "mcp"/"Test Server" Integration
    // in more than one test for this same organisationId — without this
    // cleanup, the second creation hits Integration's
    // (organisationId, provider, name) unique constraint regardless of
    // anything this task implements. Scoped to `organisationId` only, so
    // the "different organisation" test's own integration (deleted
    // explicitly at the end of that test) is untouched.
    await prisma.integration.deleteMany({ where: { organisationId } });
  });

  it("still accepts a fixed built-in tool name", async () => {
    const agent = await agentService.createAgent(organisationId, {
      ...baseAgentInput,
      toolNames: ["find_record"],
    });
    expect(agent.id).toBeDefined();
  });

  it("rejects a made-up tool name that matches neither shape", async () => {
    await expect(
      agentService.createAgent(organisationId, {
        ...baseAgentInput,
        toolNames: ["not_a_real_tool"],
      }),
    ).rejects.toThrow(/not a valid tool/i);
  });

  it("accepts a real discovered mcp tool name for this organisation", async () => {
    // Directly seeds a connected mcp Integration with a cached tool list
    // (Task 3's live-connect path is exercised in its own test file) —
    // this test is only about the grant-validation boundary.
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "mcp",
        name: "Test Server",
        config: {
          url: "https://example.test/mcp",
          tools: [
            {
              name: "search",
              description: "",
              inputSchema: { type: "object" },
              readOnlyHint: true,
            },
          ],
        },
        credentials: null,
      },
    });
    const integration = await prisma.integration.findFirstOrThrow({
      where: { organisationId, provider: "mcp" },
    });

    const agent = await agentService.createAgent(organisationId, {
      ...baseAgentInput,
      toolNames: [`mcp:${integration.id}:search`],
    });
    expect(agent.id).toBeDefined();
  });

  it("rejects an mcp tool name for a connection that doesn't have it", async () => {
    const integration = await prisma.integration.create({
      data: {
        organisationId,
        provider: "mcp",
        name: "Test Server",
        config: { url: "https://example.test/mcp", tools: [] },
        credentials: null,
      },
    });

    await expect(
      agentService.createAgent(organisationId, {
        ...baseAgentInput,
        toolNames: [`mcp:${integration.id}:search`],
      }),
    ).rejects.toThrow(/does not exist/i);
  });

  it("rejects an mcp tool name copied from a different organisation's connection", async () => {
    const otherOrgId = "test-org-grant-validation-other";
    await prisma.organisation.create({
      data: { id: otherOrgId, clerkOrgId: otherOrgId, name: "Other Org" },
    });
    const otherIntegration = await prisma.integration.create({
      data: {
        organisationId: otherOrgId,
        provider: "mcp",
        name: "Other Org's Server",
        config: {
          url: "https://example.test/mcp",
          tools: [
            {
              name: "search",
              description: "",
              inputSchema: { type: "object" },
              readOnlyHint: true,
            },
          ],
        },
        credentials: null,
      },
    });

    await expect(
      agentService.createAgent(organisationId, {
        ...baseAgentInput,
        toolNames: [`mcp:${otherIntegration.id}:search`],
      }),
    ).rejects.toThrow(/does not exist/i);

    await prisma.integration.deleteMany({
      where: { organisationId: otherOrgId },
    });
    await prisma.organisation.deleteMany({ where: { id: otherOrgId } });
  });
});
