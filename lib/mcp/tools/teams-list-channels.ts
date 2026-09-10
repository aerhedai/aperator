import { z } from "zod";

import { getValidTeamsAccessToken } from "@/lib/integrations/integration-service";
import { listTeamChannels } from "@/lib/integrations/teams/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  teamId: z
    .string()
    .min(1)
    .describe('The teamId, from Teams\' "Get link to team".'),
};

const outputSchema = {
  channels: z.array(z.object({ id: z.string(), displayName: z.string() })),
};

/**
 * Read-only, never approval-gated. Lets an agent discover a channel's id
 * (previously only obtainable by a human copying it from Teams' own UI)
 * before calling TEAMS_POST_MESSAGE/TEAMS_READ_CHANNEL_MESSAGES.
 */
export function createTeamsListChannelsTool(
  organisationId: string,
  teamsIntegrationId?: string | null,
) {
  return {
    name: "TEAMS_LIST_CHANNELS",
    description:
      "List the channels in a Microsoft Teams team — use this to find a channelId before posting to or reading from it.",
    inputSchema,
    outputSchema,
    handler: async ({ teamId }: { teamId: string }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "teams",
          teamsIntegrationId,
          "TEAMS_LIST_CHANNELS",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidTeamsAccessToken(
          organisationId,
          teamsIntegrationId,
        );
        const channels = await listTeamChannels(accessToken, teamId);
        return toolSuccess({ channels });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
