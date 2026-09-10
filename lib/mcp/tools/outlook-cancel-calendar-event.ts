import { z } from "zod";

import { getValidOutlookCalendarAccessToken } from "@/lib/integrations/integration-service";
import { cancelCalendarEvent } from "@/lib/integrations/outlook-calendar/client";
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
  comment: z
    .string()
    .optional()
    .describe(
      "An optional note included in the cancellation message sent to attendees.",
    ),
};

const outputSchema = {
  cancelled: z.boolean(),
};

/**
 * Approval-gated: cancelling sends every attendee a cancellation message
 * and removes the event — hard to undo once they've been told, same
 * reasoning as OUTLOOK_CREATE_CALENDAR_EVENT/OUTLOOK_UPDATE_CALENDAR_EVENT.
 */
export function createOutlookCancelCalendarEventTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "OUTLOOK_CANCEL_CALENDAR_EVENT",
    description:
      "Cancel an Outlook Calendar event, notifying attendees — always requires approval, since it can't be undone once attendees are told.",
    inputSchema,
    outputSchema,
    handler: async ({
      eventId,
      comment,
    }: {
      eventId: string;
      comment?: string;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "outlook-calendar",
          actionIntegrationId,
          "OUTLOOK_CANCEL_CALENDAR_EVENT",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidOutlookCalendarAccessToken(
          organisationId,
          actionIntegrationId,
        );
        await cancelCalendarEvent(accessToken, eventId, comment);
        return toolSuccess({ cancelled: true });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
