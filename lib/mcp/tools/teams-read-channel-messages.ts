import { z } from "zod";

import { getValidTeamsAccessToken } from "@/lib/integrations/integration-service";
import { readTeamChannelMessages } from "@/lib/integrations/teams/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  teamId: z.string().min(1),
  channel: z.string().min(1).describe("The channelId."),
  maxResults: z.number().int().min(1).max(50).default(20),
};

const outputSchema = {
  messages: z.array(
    z.object({
      id: z.string(),
      from: z.string().nullable(),
      content: z.string(),
      createdDateTime: z.string(),
    }),
  ),
};

/**
 * Read-only, never approval-gated. TEAMS_POST_MESSAGE's read counterpart —
 * lets an agent see a channel's recent conversation before deciding
 * whether/what to post, e.g. to avoid repeating something already said.
 */
export function createTeamsReadChannelMessagesTool(
  organisationId: string,
  teamsIntegrationId?: string | null,
) {
  return {
    name: "TEAMS_READ_CHANNEL_MESSAGES",
    description:
      "Read recent messages from a Microsoft Teams channel — content is returned as Teams' own HTML, most recent first.",
    inputSchema,
    outputSchema,
    handler: async ({
      teamId,
      channel,
      maxResults,
    }: {
      teamId: string;
      channel: string;
      maxResults: number;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "teams",
          teamsIntegrationId,
          "TEAMS_READ_CHANNEL_MESSAGES",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidTeamsAccessToken(
          organisationId,
          teamsIntegrationId,
        );
        const messages = await readTeamChannelMessages(
          accessToken,
          teamId,
          channel,
          maxResults,
        );
        return toolSuccess({ messages });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
