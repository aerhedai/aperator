import type { CategoryType } from "@/lib/agents/schemas";

/**
 * One handler a WorkflowTemplate installs alongside its classifier — the
 * same shape AgentSpec (lib/agents/agent-spec-install.ts) needs, plus
 * `keywords` for the deterministic fast path
 * (lib/routing/deterministic-classify.ts) that lets a multi-handler
 * department skip the LLM classifier call entirely when a message clearly
 * names one handler over the others.
 */
export interface WorkflowTemplateHandler {
  name: string;
  description: string;
  categoryType: CategoryType;
  instructions: string;
  suggestedTools: string[];
  steps?: unknown;
  keywords?: string[];
  extractionFields?: { name: string; description: string }[];
  guardrailKeywords?: string[];
}

export interface WorkflowTemplateSummary {
  id: string;
  name: string;
  description: string;
  classifierInstructions: string;
  handlers: WorkflowTemplateHandler[];
  recordTypes: string[];
  builtIn: boolean;
}
