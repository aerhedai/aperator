import { z } from "zod";

import { getValidOutlookCalendarAccessToken } from "@/lib/integrations/integration-service";
import { listCalendarEvents } from "@/lib/integrations/outlook-calendar/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  start: z.iso.datetime(),
  end: z.iso.datetime(),
};

const outputSchema = {
  events: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      start: z.string(),
      end: z.string(),
    }),
  ),
};

/**
 * Read-only, never approval-gated. The counterpart
 * OUTLOOK_CHECK_CALENDAR_AVAILABILITY answers "when's everyone free" —
 * this answers "what's already on the calendar," e.g. for a daily/weekly
 * summary routine.
 */
export function createOutlookListCalendarEventsTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "OUTLOOK_LIST_CALENDAR_EVENTS",
    description:
      "List events on the connected Outlook Calendar within a time range, expanding recurring events into their actual occurrences.",
    inputSchema,
    outputSchema,
    handler: async ({ start, end }: { start: string; end: string }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "outlook-calendar",
          actionIntegrationId,
          "OUTLOOK_LIST_CALENDAR_EVENTS",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidOutlookCalendarAccessToken(
          organisationId,
          actionIntegrationId,
        );
        const events = await listCalendarEvents(accessToken, { start, end });
        return toolSuccess({ events });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
