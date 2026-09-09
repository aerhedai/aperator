import * as agentService from "@/lib/agents/agent-service";
import { DEFAULT_AGENT_MODEL } from "@/lib/agents/default-agent-config";
import { validatePipelineConfig } from "@/lib/agents/pipeline-config-form";
import { agentInputSchema, type CategoryType } from "@/lib/agents/schemas";

/**
 * The data a template (a lone AgentTemplate, or one handler/classifier
 * inside a WorkflowTemplate) needs to describe before it becomes a real
 * Agent — everything installAgentSpec runs through the exact same
 * validation and creation path a hand-built agent goes through
 * (agentInputSchema, validatePipelineConfig, agentService.createAgent),
 * shared so "a business clicking Install" and "chat installing this on its
 * own initiative" can never quietly diverge, and so a single-agent
 * template and a workflow template's handlers are installed identically
 * rather than by two hand-rolled copies of this logic.
 */
export interface AgentSpec {
  name: string;
  description: string;
  // Empty means "build a generic wrapper from name+description" — only
  // categoryType "steps" behaves usefully with that fallback (see
  // installAgentSpec); every other categoryType should supply real
  // instructions.
  instructions: string;
  categoryType: CategoryType;
  suggestedTools: string[];
  steps?: unknown;
  keywords?: string[];
  extractionFields?: { name: string; description: string }[];
  guardrailKeywords?: string[];
}

export type InstallAgentSpecResult =
  | { ok: true; agentId: string; agentName: string }
  | { ok: false; error: string };

/**
 * Installs one AgentSpec as a real (DRAFT) Agent. The created agent is
 * always DRAFT — reviewable and deletable before it does anything, same as
 * one built by hand — callers that need it live immediately (e.g.
 * installWorkflowTemplate, where a department isn't useful sitting in
 * DRAFT) explicitly activate it afterwards via agentService.updateAgentStatus.
 */
export async function installAgentSpec(
  organisationId: string,
  spec: AgentSpec,
): Promise<InstallAgentSpecResult> {
  const parsed = agentInputSchema.safeParse({
    name: spec.name,
    description: spec.description,
    instructions:
      spec.instructions ||
      `Follow the "${spec.name}" process: ${spec.description}`,
    model: DEFAULT_AGENT_MODEL,
    categoryType: spec.categoryType,
    toolNames: spec.suggestedTools,
    keywords: spec.keywords ?? [],
    extractionFields: spec.extractionFields ?? [],
    guardrailKeywords: spec.guardrailKeywords ?? [],
    pipelineConfig: spec.steps ?? {},
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  const validated = validatePipelineConfig(
    spec.categoryType,
    parsed.data.pipelineConfig,
  );
  if ("error" in validated) {
    return { ok: false, error: validated.error };
  }

  try {
    const agent = await agentService.createAgent(organisationId, {
      ...parsed.data,
      pipelineConfig: validated.config,
    });
    return { ok: true, agentId: agent.id, agentName: agent.name };
  } catch (error) {
    const message =
      error instanceof agentService.ToolGrantError
        ? error.message
        : "Couldn't install this agent.";
    return { ok: false, error: message };
  }
}
