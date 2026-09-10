import { z } from "zod";

import { getValidOutlookCalendarAccessToken } from "@/lib/integrations/integration-service";
import { updateCalendarEvent } from "@/lib/integrations/outlook-calendar/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  eventId: z
    .string()
    .min(1)
    .describe(
      "An event id, as returned by OUTLOOK_CREATE_CALENDAR_EVENT/OUTLOOK_LIST_CALENDAR_EVENTS.",
    ),
  subject: z.string().min(1).optional(),
  start: z.iso.datetime().optional(),
  end: z.iso.datetime().optional(),
  attendees: z
    .array(z.email())
    .optional()
    .describe("Replaces the entire attendee list if supplied."),
};

const outputSchema = {
  updated: z.boolean(),
};

/**
 * Approval-gated, same reasoning as OUTLOOK_CREATE_CALENDAR_EVENT: Graph
 * notifies every attendee of the change automatically — approving after
 * the fact can't un-notify them.
 */
export function createOutlookUpdateCalendarEventTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "OUTLOOK_UPDATE_CALENDAR_EVENT",
    description:
      "Update an existing Outlook Calendar event's subject, time, or attendees — always requires approval, since attendees are notified of the change.",
    inputSchema,
    outputSchema,
    handler: async ({
      eventId,
      subject,
      start,
      end,
      attendees,
    }: {
      eventId: string;
      subject?: string;
      start?: string;
      end?: string;
      attendees?: string[];
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "outlook-calendar",
          actionIntegrationId,
          "OUTLOOK_UPDATE_CALENDAR_EVENT",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidOutlookCalendarAccessToken(
          organisationId,
          actionIntegrationId,
        );
        await updateCalendarEvent(accessToken, eventId, {
          subject,
          start,
          end,
          attendees,
        });
        return toolSuccess({ updated: true });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
