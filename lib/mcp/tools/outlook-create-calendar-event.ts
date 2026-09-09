import { z } from "zod";

import { getValidOutlookCalendarAccessToken } from "@/lib/integrations/integration-service";
import { createCalendarEvent } from "@/lib/integrations/outlook-calendar/client";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  subject: z.string().min(1),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  attendees: z.array(z.email()).min(1),
};

const outputSchema = {
  created: z.boolean(),
  eventId: z.string(),
};

/**
 * organisationId/actionIntegrationId bound at server-construction time,
 * never a tool argument (CLAUDE.md §22). Mutating and externally visible
 * once attendees are invited — always requires human approval before
 * executing (lib/policies/policy-engine.ts's
 * REQUIRES_APPROVAL_BEFORE_EXECUTION), the same reasoning as
 * GMAIL_SEND_EMAIL/OUTLOOK_SEND_EMAIL: approving after the fact can't
 * un-invite a real meeting. Named with the OUTLOOK_ prefix even though it's
 * the only calendar provider today — see
 * OUTLOOK_CHECK_CALENDAR_AVAILABILITY's own comment for why.
 */
export function createOutlookCreateCalendarEventTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "OUTLOOK_CREATE_CALENDAR_EVENT",
    description:
      "Create a real Outlook Calendar event and invite attendees — always requires approval before sending.",
    inputSchema,
    outputSchema,
    handler: async ({
      subject,
      start,
      end,
      attendees,
    }: {
      subject: string;
      start: string;
      end: string;
      attendees: string[];
    }) => {
      try {
        const accessToken = await getValidOutlookCalendarAccessToken(
          organisationId,
          actionIntegrationId,
        );
        const event = await createCalendarEvent(accessToken, {
          subject,
          start,
          end,
          attendees,
        });
        return toolSuccess({ created: true, eventId: event.id });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to create calendar event.";
        return toolError(message);
      }
    },
  };
}
