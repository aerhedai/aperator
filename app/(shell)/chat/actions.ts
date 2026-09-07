"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import * as chatAgentService from "@/lib/agents/chat-agent-service";
import type { RunStatus, RunStepType } from "@/lib/generated/prisma/client";
import { TOOL_NAMES, type ToolName } from "@/lib/mcp/tool-registry";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as runService from "@/lib/runs/run-service";
import {
  beginNewChatRun,
  loadSnapshotMessages,
  recordChatTurnStart,
  runChatTurn,
} from "@/lib/runtime/agent-runtime";

export interface ChatSettingsState {
  error?: string;
}

function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

/**
 * Starts a brand new chat thread. The model turn is deferred to after() so
 * the redirect (and the client's first poll) sees the human's own message
 * and a RUNNING status immediately, rather than waiting for the whole turn
 * — including any tool calls — to finish before the page can even load.
 */
export async function startChatAction(formData: FormData): Promise<void> {
  const organisation = await getCurrentOrganisation();
  const message = String(formData.get("message") ?? "").trim();
  if (!message) {
    redirect("/chat");
  }

  const agent = await chatAgentService.getOrCreateChatAgent(organisation.id);
  const runId = await beginNewChatRun(agent, message);

  after(() =>
    runChatTurn(organisation.id, runId, agent, [
      { role: "system", content: agent.instructions },
      { role: "user", content: message },
    ]),
  );

  revalidatePath("/chat", "layout");
  redirect(`/chat/${runId}`);
}

/**
 * Sends the next message in an existing thread. Same deferred-turn shape
 * as startChatAction — recordChatTurnStart runs synchronously (so the
 * user's message and RUNNING status are visible the instant this resolves),
 * the actual model turn runs in after().
 */
export async function sendChatMessageAction(
  runId: string,
  message: string,
): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) return;

  const organisation = await getCurrentOrganisation();
  const agent = await recordChatTurnStart(organisation.id, runId, trimmed);
  const messages = await loadSnapshotMessages(runId);
  messages.push({ role: "user", content: trimmed });

  after(() => runChatTurn(organisation.id, runId, agent, messages));
}

export interface ChatRunStepView {
  id: string;
  stepType: RunStepType;
  detail: string | null;
  toolName: string | null;
  toolStatus: "SUCCESS" | "FAILED" | null;
  createdAt: Date;
}

export interface ChatRunStateView {
  status: RunStatus;
  steps: ChatRunStepView[];
}

// Polled by the client while a turn is in progress — the live-progress
// surface is built entirely from RunStep rows (already written
// incrementally by the unmodified runLoop), not from AgentRun.messages,
// which only updates once a turn finishes.
export async function getChatRunStateAction(
  runId: string,
): Promise<ChatRunStateView> {
  const organisation = await getCurrentOrganisation();
  const run = await runService.getRun(organisation.id, runId);
  if (!run) throw new Error("Run not found");

  return {
    status: run.status,
    steps: run.steps.map((step) => ({
      id: step.id,
      stepType: step.stepType,
      detail: step.detail,
      toolName: step.toolCall?.toolName ?? null,
      toolStatus: step.toolCall?.status ?? null,
      createdAt: step.createdAt,
    })),
  };
}

export async function updateChatSettingsAction(
  _prevState: ChatSettingsState,
  formData: FormData,
): Promise<ChatSettingsState> {
  const organisation = await getCurrentOrganisation();
  const agent = await chatAgentService.getOrCreateChatAgent(organisation.id);

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const instructions = String(formData.get("instructions") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const toolNames = formData.getAll("toolNames").map(String).filter(isToolName);
  const invokableAgentIds = formData.getAll("invokableAgentIds").map(String);

  if (!name || !description || !instructions || !model) {
    return {
      error: "Name, description, instructions, and model are all required.",
    };
  }

  await chatAgentService.updateChatAgentSettings(organisation.id, agent.id, {
    name,
    description,
    instructions,
    model,
    toolNames,
    invokableAgentIds,
  });

  redirect("/chat/settings");
}
