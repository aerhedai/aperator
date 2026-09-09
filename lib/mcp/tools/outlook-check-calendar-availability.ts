import { z } from "zod";

import { getValidOutlookCalendarAccessToken } from "@/lib/integrations/integration-service";
import { findMeetingTimes } from "@/lib/integrations/outlook-calendar/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  attendees: z.array(z.email()).min(1),
  durationMinutes: z.number().int().positive(),
  rangeStart: z.iso.datetime(),
  rangeEnd: z.iso.datetime(),
};

const outputSchema = {
  found: z.boolean(),
  suggestions: z.array(
    z.object({
      start: z.string(),
      end: z.string(),
      confidence: z.number(),
    }),
  ),
};

/**
 * Read-only (same readOnlyHint annotation as find_record/search_records in
 * lib/mcp/server.ts) — organisationId/actionIntegrationId bound at
 * server-construction time, never a tool argument (CLAUDE.md §22). Named
 * with the OUTLOOK_ prefix even though it's the only calendar provider
 * today, for consistency with every other provider-specific tool and so a
 * future second calendar provider doesn't require renaming this one out
 * from under existing grants.
 */
export function createOutlookCheckCalendarAvailabilityTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "OUTLOOK_CHECK_CALENDAR_AVAILABILITY",
    description:
      "Find suggested meeting times for a set of attendees within a date range, using the connected Outlook Calendar's free/busy data.",
    inputSchema,
    outputSchema,
    handler: async ({
      attendees,
      durationMinutes,
      rangeStart,
      rangeEnd,
    }: {
      attendees: string[];
      durationMinutes: number;
      rangeStart: string;
      rangeEnd: string;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "outlook-calendar",
          actionIntegrationId,
          "OUTLOOK_CHECK_CALENDAR_AVAILABILITY",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidOutlookCalendarAccessToken(
          organisationId,
          actionIntegrationId,
        );
        const suggestions = await findMeetingTimes(accessToken, {
          attendees,
          durationMinutes,
          rangeStart,
          rangeEnd,
        });
        return toolSuccess({ found: suggestions.length > 0, suggestions });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
