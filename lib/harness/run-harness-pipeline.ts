import type { AIProvider } from "@/lib/ai/provider";
import * as agentToolRepository from "@/lib/agents/agent-tool-repository";
import type { Agent } from "@/lib/generated/prisma/client";
import { getPipeline } from "@/lib/harness/pipelines";
import type { ResolvedAttachment } from "@/lib/harness/types";
import { connectMcpClient } from "@/lib/mcp/client";
import * as organisationRepository from "@/lib/organisations/organisation-repository";
import * as runRepository from "@/lib/runs/run-repository";
import type { RunResult } from "@/lib/runtime/agent-runtime";

/**
 * The HARNESS-mode counterpart to runAgent() (lib/runtime/agent-runtime.ts)
 * — same AgentRun/RunStep/ToolCall persistence, same approval gate, same
 * per-agent tool restriction, just driven by a deterministic pipeline
 * instead of a free-form tool-calling loop. See lib/harness/types.ts.
 */
export async function runHarnessPipeline(
  agent: Agent,
  input: string,
  provider: AIProvider,
  senderEmail: string | null = null,
  getAttachments?: () => Promise<ResolvedAttachment[]>,
): Promise<RunResult> {
  const run = await runRepository.createRun(
    agent.organisationId,
    agent.id,
    input,
  );
  await runRepository.markRunStatus(run.id, "RUNNING", {
    startedAt: new Date(),
  });
  await runRepository.addRunStep(run.id, "INPUT_RECEIVED", input);

  const mcpClient = await connectMcpClient(
    agent.organisationId,
    agent.actionIntegrationId,
    agent.id,
    0,
    provider,
  );

  try {
    const pipeline = getPipeline(agent.pipelineKey);
    if (!pipeline) {
      throw new Error(
        `No harness pipeline registered for key "${agent.pipelineKey}".`,
      );
    }

    const allowedTools = new Set(
      await agentToolRepository.findToolNamesForAgent(agent.id),
    );
    const organisation = await organisationRepository.findOrganisationById(
      agent.organisationId,
    );
    if (!organisation) {
      throw new Error(`Organisation "${agent.organisationId}" not found.`);
    }

    return await pipeline({
      runId: run.id,
      organisationId: agent.organisationId,
      organisation,
      agent,
      input,
      senderEmail,
      getAttachments,
      mcpClient,
      provider,
      allowedTools,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    await runRepository.markRunStatus(run.id, "FAILED", {
      completedAt: new Date(),
    });
    await runRepository.addRunStep(run.id, "RUN_FAILED", message);
    return { runId: run.id, status: "FAILED" };
  } finally {
    await mcpClient.close();
  }
}
