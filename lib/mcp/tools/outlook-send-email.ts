import { z } from "zod";

import { getValidOutlookAccessToken } from "@/lib/integrations/integration-service";
import { sendOutlookMessage } from "@/lib/integrations/outlook/client";
import {
  attachmentRefSchema,
  resolveStorageAttachment,
} from "@/lib/mcp/tools/shared/resolve-storage-attachment";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  to: z.email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  attachments: z
    .array(attachmentRefSchema)
    .optional()
    .describe(
      "Files already saved in the business's connected storage to attach — not raw content.",
    ),
};

const outputSchema = {
  sent: z.boolean(),
};

/**
 * organisationId (and actionIntegrationId) are bound at server-construction
 * time (see lib/mcp/server.ts), never taken as a tool argument — the LLM
 * must never be able to supply which organisation's or which account's
 * credentials to use (CLAUDE.md §22), so this closes over the
 * caller-supplied values instead. actionIntegrationId null/undefined means
 * "the organisation's default Outlook account" — see
 * getValidOutlookAccessToken's own doc comment.
 *
 * Attachments are references to files already saved in connected storage,
 * not raw bytes passed as a tool argument — same reasoning as
 * GMAIL_SEND_EMAIL's own comment.
 */
export function createOutlookSendEmailTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "OUTLOOK_SEND_EMAIL",
    description:
      "Send an email reply via the connected Outlook account, e.g. with a finished quote and its attachments.",
    inputSchema,
    outputSchema,
    handler: async ({
      to,
      subject,
      body,
      attachments,
    }: {
      to: string;
      subject: string;
      body: string;
      attachments?: z.infer<typeof attachmentRefSchema>[];
    }) => {
      try {
        const resolvedAttachments = attachments
          ? await Promise.all(
              attachments.map((ref) =>
                resolveStorageAttachment(organisationId, ref),
              ),
            )
          : undefined;

        const accessToken = await getValidOutlookAccessToken(
          organisationId,
          actionIntegrationId,
        );
        await sendOutlookMessage(accessToken, {
          to,
          subject,
          body,
          attachments: resolvedAttachments,
        });
        return toolSuccess({ sent: true });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to send email.";
        return toolError(message);
      }
    },
  };
}
