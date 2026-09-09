import { z } from "zod";

import { completePipeline } from "@/lib/harness/pipeline-completion";
import { failPipeline } from "@/lib/harness/pipeline-failure";
import { callTool } from "@/lib/harness/pipeline-helpers";
import type { PipelineContext, Pipeline } from "@/lib/harness/types";

// Both save calls below need this exact branch — a small local helper
// rather than duplicating it, not a new shared abstraction beyond this
// one file's own use of it.
function saveFile(
  context: PipelineContext,
  provider: "google-drive" | "sharepoint",
  siteName: string | undefined,
  args: {
    path: string[];
    filename: string;
    mimeType: string;
    contentBase64: string;
    replace: boolean;
  },
) {
  return provider === "google-drive"
    ? callTool(context, "GOOGLE_DRIVE_SAVE_FILE", args)
    : callTool(context, "SHAREPOINT_SAVE_FILE", { ...args, siteName });
}

// Agent.pipelineConfig's shape for this pipeline. A business points this
// at a mailbox that only ever receives replies to something it already
// sent with a reference token in the subject (e.g. the acknowledgement
// email entity_status_signal composes) — same "structural identification,
// never guessed from free text" reasoning CLAUDE.md #14 already applies
// to senderEmail.
// Exported for the same reason as entity-status-signal-pipeline.ts's
// pipelineConfigSchema — the Agent form validates against this exact
// schema, not a hand-copied approximation of it.
export const pipelineConfigSchema = z.object({
  // Which CustomEntityType a reference token identifies a record in.
  recordType: z.string().min(1),
  keyField: z.string().min(1),
  // A regex (as a string) with exactly one capture group — the matched
  // group is looked up against keyField. e.g. "\\[Job #([A-Za-z0-9-]+)\\]"
  // matches a subject containing "[Job #1042]".
  subjectPattern: z.string().min(1),
  provider: z.enum(["google-drive", "sharepoint"]),
  siteName: z.string().optional(),
  // Which record field names the root folder — usually the same value as
  // keyField, but kept separate in case a business wants a friendlier
  // folder name than the raw key.
  rootFolderField: z.string().min(1),
  correspondenceSubfolder: z.string().min(1),
  // The one file that's always overwritten, never duplicated — a thread's
  // latest message already carries the full quoted history, so this is
  // "the conversation so far," not "one file per reply."
  correspondenceFilename: z.string().min(1),
});

export type EntityCorrespondenceArchiveConfig = z.infer<
  typeof pipelineConfigSchema
>;

/**
 * EMAIL-triggered, zero LLM calls. Extracts a reference token from the
 * subject line (already present in context.input — see
 * app/(app)/dashboard/actions.ts), finds the record it identifies, and
 * archives this message: the body replaces whatever was archived before
 * (a thread's latest message already contains the full history via
 * quoting), while attachments accumulate — each one is a real file in its
 * own right, not superseded by a later message.
 */
export const runEntityCorrespondenceArchivePipeline: Pipeline = async (
  context,
) => {
  const configResult = pipelineConfigSchema.safeParse(
    context.agent.pipelineConfig,
  );
  if (!configResult.success) {
    return failPipeline(
      context,
      "This agent's pipelineConfig is missing or invalid — set recordType, keyField, subjectPattern, provider, rootFolderField, correspondenceSubfolder, and correspondenceFilename.",
    );
  }
  const config = configResult.data;

  let pattern: RegExp;
  try {
    pattern = new RegExp(config.subjectPattern);
  } catch {
    return failPipeline(
      context,
      "This agent's subjectPattern is not a valid regex.",
    );
  }

  const match = context.input.match(pattern);
  const keyValue = match?.[1];
  if (!keyValue) {
    return failPipeline(
      context,
      "No matching reference token was found in the subject line.",
    );
  }

  const found = await callTool(context, "find_record", {
    recordType: config.recordType,
    field: config.keyField,
    value: keyValue,
  });
  if (found.isError || !found.structuredContent?.found) {
    return failPipeline(
      context,
      `No ${config.recordType} record found for "${keyValue}".`,
    );
  }
  const record = found.structuredContent.record as {
    id: string;
    data: Record<string, unknown>;
  };

  const rootFolderValue = record.data[config.rootFolderField];
  const root =
    typeof rootFolderValue === "string" && rootFolderValue
      ? rootFolderValue
      : keyValue;

  const bodySave = await saveFile(context, config.provider, config.siteName, {
    path: [root, config.correspondenceSubfolder],
    filename: config.correspondenceFilename,
    mimeType: "text/plain",
    contentBase64: Buffer.from(context.input, "utf-8").toString("base64"),
    replace: true,
  });
  if (bodySave.isError) {
    return failPipeline(context, "Could not save the correspondence.");
  }

  const attachments = context.getAttachments
    ? await context.getAttachments()
    : [];
  for (const attachment of attachments) {
    const attachmentSave = await saveFile(
      context,
      config.provider,
      config.siteName,
      {
        path: [root, config.correspondenceSubfolder],
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        contentBase64: attachment.content.toString("base64"),
        replace: false,
      },
    );
    if (attachmentSave.isError) {
      return failPipeline(
        context,
        `Could not save the attachment "${attachment.filename}".`,
      );
    }
  }

  return completePipeline(
    context,
    `Correspondence archived for "${keyValue}"${
      attachments.length > 0 ? ` with ${attachments.length} attachment(s)` : ""
    }.`,
  );
};
