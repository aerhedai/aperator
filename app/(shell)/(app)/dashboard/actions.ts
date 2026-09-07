"use server";

import { redirect } from "next/navigation";

import { cleanEmailBody } from "@/lib/integrations/gmail/clean-email-body";
import {
  getGmailAttachmentContent,
  getGmailMessage,
  listUnreadInboxMessages,
  markGmailMessageRead,
} from "@/lib/integrations/gmail/client";
import * as integrationService from "@/lib/integrations/integration-service";
import {
  getOutlookMessage,
  listOutlookAttachments,
  listUnreadOutlookMessages,
  markOutlookMessageRead,
} from "@/lib/integrations/outlook/client";
import { extractEmailDeterministically } from "@/lib/harness/pipeline-helpers";
import type { ResolvedAttachment } from "@/lib/harness/types";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import { dispatchInboundMessage } from "@/lib/routing/dispatch";

interface EmailMessageSummary {
  id: string;
}

interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
}

// Small, file-local adapter map — exists purely to avoid branching in the
// loop below over exactly 2 real cases (Gmail, Outlook), not a new shared
// abstraction layer. Both providers' client functions already share this
// exact shape.
const EMAIL_PROVIDER_ADAPTERS: Record<
  "gmail" | "outlook",
  {
    listUnread: (accessToken: string) => Promise<EmailMessageSummary[]>;
    getMessage: (accessToken: string, id: string) => Promise<EmailMessage>;
    // A second call, not folded into getMessage — most inbound email has
    // no attachments, and this is only ever invoked lazily by a pipeline
    // that actually wants them (see PipelineContext.getAttachments).
    resolveAttachments: (
      accessToken: string,
      messageId: string,
    ) => Promise<ResolvedAttachment[]>;
    markRead: (accessToken: string, id: string) => Promise<void>;
    getAccessToken: (
      organisationId: string,
      integrationId: string,
    ) => Promise<string>;
  }
> = {
  gmail: {
    listUnread: listUnreadInboxMessages,
    getMessage: getGmailMessage,
    resolveAttachments: async (accessToken, messageId) => {
      const message = await getGmailMessage(accessToken, messageId);
      return Promise.all(
        message.attachments.map(async (ref) => ({
          filename: ref.filename,
          mimeType: ref.mimeType,
          content: await getGmailAttachmentContent(
            accessToken,
            messageId,
            ref.attachmentId,
          ),
        })),
      );
    },
    markRead: markGmailMessageRead,
    getAccessToken: integrationService.getValidGmailAccessToken,
  },
  outlook: {
    listUnread: listUnreadOutlookMessages,
    getMessage: getOutlookMessage,
    resolveAttachments: listOutlookAttachments,
    markRead: markOutlookMessageRead,
    getAccessToken: integrationService.getValidOutlookAccessToken,
  },
};

/**
 * On-demand inbox check (no background worker/polling infra per CLAUDE.md
 * #30 — this is a manual trigger the user clicks, not a cron job).
 * Organisation-scoped, not agent-scoped: each unread labelled/foldered
 * email is classified and routed to whichever active agent fits (see
 * lib/routing/dispatch.ts), not tied to any one agent's page.
 *
 * Provider-agnostic across Gmail and Outlook Mail — checks one default
 * account per connected provider (0–2 accounts), not every account ever
 * connected. This exactly preserves the original Gmail-only behavior when
 * only Gmail is connected, and only does more work once Outlook is also
 * connected.
 */
export async function checkInboxAction() {
  const organisation = await getCurrentOrganisation();

  let processed = 0;
  let skipped = 0;
  try {
    const integrations = await integrationService.getConnectedEmailIntegrations(
      organisation.id,
    );
    if (integrations.length === 0) {
      throw new Error(
        "No email account (Gmail or Outlook) is connected for this organisation. Connect one from Settings.",
      );
    }

    for (const integration of integrations) {
      const provider = integration.provider as "gmail" | "outlook";
      const adapter = EMAIL_PROVIDER_ADAPTERS[provider];
      const accessToken = await adapter.getAccessToken(
        organisation.id,
        integration.id,
      );
      const unread = await adapter.listUnread(accessToken);

      for (const summary of unread) {
        const message = await adapter.getMessage(accessToken, summary.id);
        // Subject + body only — never the sender's address. Classification
        // (both the keyword fast path and the LLM classifier) matches
        // directly over this text, and a customer's own email address can
        // accidentally contain a keyword substring (e.g. "...price@..."
        // silently routing everything to the Quote Agent, found live). The
        // sender is passed separately below, used only for identification.
        const input = `New email received.\nSubject: ${message.subject}\n\n${cleanEmailBody(message.body)}`;
        const senderEmail = extractEmailDeterministically(message.from);
        const getAttachments = () =>
          adapter.resolveAttachments(accessToken, summary.id);
        const result = await dispatchInboundMessage(
          organisation.id,
          "EMAIL",
          input,
          undefined,
          senderEmail,
          integration.id,
          getAttachments,
        );

        if (result.matched) {
          await adapter.markRead(accessToken, summary.id);
          processed += 1;
        } else if (result.reason === "no_workflow") {
          // Not a per-email skip — nothing is configured to handle email at
          // all, so stop immediately rather than repeating the same failure
          // for every remaining message.
          throw new Error(
            "No active email workflow is configured for this organisation.",
          );
        } else {
          // Left unprocessed on purpose: no agent's scope clearly fit, so
          // nothing runs and nothing gets marked read — it stays visible in
          // the inbox for a human to notice, rather than being silently
          // dropped or guessed at.
          skipped += 1;
        }
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to check inbox.";
    redirect(`/dashboard?inbox_error=${encodeURIComponent(message)}`);
  }

  redirect(`/dashboard?inbox_processed=${processed}&inbox_skipped=${skipped}`);
}
