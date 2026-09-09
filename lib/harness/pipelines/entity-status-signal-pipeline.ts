import { z } from "zod";

import { env } from "@/lib/env";
import { completePipeline } from "@/lib/harness/pipeline-completion";
import { failPipeline } from "@/lib/harness/pipeline-failure";
import { callTool } from "@/lib/harness/pipeline-helpers";
import { proposeAction, resolveActionTool } from "@/lib/harness/propose-action";
import type { Pipeline } from "@/lib/harness/types";

// Agent.pipelineConfig's shape for this pipeline — validated here, not in
// the database (see the schema.prisma comment on pipelineConfig). A
// business configures this once per agent to track its own kind of record
// (a Job, an Application, an Order, ...) through an external system's
// status changes; nothing here names a specific business's fields.
const transitionSchema = z.object({
  createFolders: z
    .object({
      provider: z.enum(["google-drive", "sharepoint"]),
      siteName: z.string().optional(),
      // May reference {field} placeholders resolved against the record's
      // own data, e.g. "{jobId}".
      rootFolder: z.string().min(1),
      subfolders: z.array(z.string().min(1)).default([]),
    })
    .optional(),
  sendEmail: z
    .object({
      // Which field on the record holds the recipient's address.
      toField: z.string().min(1),
      subjectTemplate: z.string().min(1),
      bodyTemplate: z.string().min(1),
    })
    .optional(),
  // Deliberately not a Teams-native interactive card (no Bot Service —
  // same reasoning as the Teams integration's own "posts as the connecting
  // person" limitation). The message links back to Aperator's own
  // Approvals page instead via the {approvalUrl} placeholder, so approving
  // still happens in the one place that already has the real approval UI.
  notifyTeams: z
    .object({
      teamId: z.string().min(1),
      channelId: z.string().min(1),
      messageTemplate: z.string().min(1),
    })
    .optional(),
});

// Exported so the Agent form (components/agents/entity-status-signal-fields.tsx)
// validates a business's configuration against the exact same shape this
// pipeline actually runs against — one source of truth, not a UI-side copy
// that could drift from what's enforced at runtime.
export const pipelineConfigSchema = z.object({
  // Which CustomEntityType this pipeline tracks, e.g. "Job".
  recordType: z.string().min(1),
  // Which field on that entity uniquely identifies a record, e.g. "jobId"
  // — used to find-or-create rather than always creating a new record.
  keyField: z.string().min(1),
  // Which field on the incoming signal carries the new status value.
  statusField: z.string().min(1),
  // What to do when statusField's value matches a key here. A status with
  // no matching entry just updates the record and finishes — not every
  // transition needs to trigger anything.
  transitions: z.record(z.string(), transitionSchema),
});

export type EntityStatusSignalConfig = z.infer<typeof pipelineConfigSchema>;

function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = data[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

/**
 * Zero LLM calls — pure deterministic branching on a structured signal
 * (e.g. a Power Automate flow POSTing {jobId, status, ...} to the webhook
 * trigger this agent is bound to when a tracked item's status changes in
 * some external system). This is what "HARNESS" means when there's no
 * free text to extract anything from: the model isn't needed at all, see
 * lib/harness/types.ts's Pipeline doc comment.
 */
export const runEntityStatusSignalPipeline: Pipeline = async (context) => {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(context.input);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("not an object");
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return failPipeline(
      context,
      "Expected a structured JSON signal, but the input wasn't a JSON object.",
    );
  }

  const configResult = pipelineConfigSchema.safeParse(
    context.agent.pipelineConfig,
  );
  if (!configResult.success) {
    return failPipeline(
      context,
      "This agent's pipelineConfig is missing or invalid — set recordType, keyField, statusField, and transitions.",
    );
  }
  const config = configResult.data;

  const keyValue = payload[config.keyField];
  const statusValue = payload[config.statusField];
  if (keyValue === undefined || statusValue === undefined) {
    return failPipeline(
      context,
      `The signal is missing "${config.keyField}" or "${config.statusField}".`,
    );
  }

  const found = await callTool(context, "find_record", {
    recordType: config.recordType,
    field: config.keyField,
    value: String(keyValue),
  });
  if (found.isError) {
    return failPipeline(context, "Could not look up the tracked record.");
  }

  const existing = found.structuredContent?.found
    ? (found.structuredContent.record as {
        id: string;
        data: Record<string, unknown>;
      })
    : null;

  const writeResult = existing
    ? await callTool(context, "update_record", {
        recordType: config.recordType,
        recordId: existing.id,
        data: payload,
      })
    : await callTool(context, "create_record", {
        recordType: config.recordType,
        data: payload,
      });
  if (writeResult.isError || !writeResult.structuredContent) {
    return failPipeline(context, "Could not save the tracked record.");
  }
  const record = writeResult.structuredContent.record as {
    id: string;
    data: Record<string, unknown>;
  };
  // Available to every template below via {approvalUrl} — omitted (empty
  // string) if NEXT_PUBLIC_APP_URL isn't configured, rather than failing
  // the whole run over a notification nicety.
  const templateData = {
    ...record.data,
    approvalUrl: env.NEXT_PUBLIC_APP_URL
      ? `${env.NEXT_PUBLIC_APP_URL}/approvals`
      : "",
  };

  const transition = config.transitions[String(statusValue)];
  if (!transition) {
    return completePipeline(
      context,
      `Record updated. No configured action for status "${String(statusValue)}".`,
    );
  }

  if (transition.createFolders) {
    const { provider, siteName, rootFolder, subfolders } =
      transition.createFolders;
    const root = interpolate(rootFolder, templateData);
    const paths =
      subfolders.length > 0 ? subfolders.map((sub) => [root, sub]) : [[root]];
    for (const path of paths) {
      const folderResult =
        provider === "google-drive"
          ? await callTool(context, "GOOGLE_DRIVE_CREATE_FOLDER", { path })
          : await callTool(context, "SHAREPOINT_CREATE_FOLDER", {
              siteName,
              path,
            });
      if (folderResult.isError) {
        return failPipeline(
          context,
          `Could not create the "${path.join("/")}" folder.`,
        );
      }
    }
  }

  if (transition.notifyTeams) {
    const { teamId, channelId, messageTemplate } = transition.notifyTeams;
    const notifyResult = await callTool(context, "TEAMS_POST_MESSAGE", {
      teamId,
      channel: channelId,
      message: interpolate(messageTemplate, templateData),
    });
    if (notifyResult.isError) {
      return failPipeline(context, "Could not post the Teams notification.");
    }
  }

  if (transition.sendEmail) {
    const { toField, subjectTemplate, bodyTemplate } = transition.sendEmail;
    const to = record.data[toField];
    if (typeof to !== "string" || !to) {
      return failPipeline(
        context,
        `The record has no valid email in its "${toField}" field.`,
      );
    }
    return proposeAction(context, {
      toolName: await resolveActionTool(
        context.agent.actionTool,
        context.organisationId,
        context.agent.actionIntegrationId,
      ),
      args: {
        to,
        subject: interpolate(subjectTemplate, templateData),
        body: interpolate(bodyTemplate, templateData),
      },
    });
  }

  return completePipeline(
    context,
    `Record updated and folders created for status "${String(statusValue)}".`,
  );
};
