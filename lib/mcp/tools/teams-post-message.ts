import { z } from "zod";

import { getValidTeamsAccessToken } from "@/lib/integrations/integration-service";
import { sendTeamsChannelMessage } from "@/lib/integrations/teams/client";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  teamId: z
    .string()
    .min(1)
    .describe('The teamId, from Teams\' "Get link to channel".'),
  channel: z
    .string()
    .min(1)
    .describe('The channelId, from Teams\' "Get link to channel".'),
  message: z.string().min(1).describe("The message text to post"),
};

const outputSchema = {
  sent: z.boolean(),
};

/**
 * organisationId/teamsIntegrationId bound at server-construction time,
 * never a tool argument (CLAUDE.md §22). Same consequence-class reasoning
 * as SLACK_POST_MESSAGE's own comment for why this stays separate from the
 * email tools.
 *
 * Teams caveat, surfaced in the description rather than hidden here:
 * Microsoft Graph has no plain-OAuth "post as a bot" equivalent, so a
 * message posts as whichever person authorized the connection.
 */
export function createTeamsPostMessageTool(
  organisationId: string,
  teamsIntegrationId?: string | null,
) {
  return {
    name: "TEAMS_POST_MESSAGE",
    description:
      'Post an internal notification to a Microsoft Teams channel — pass both teamId and channel (its channelId), found via Teams\' "Get link to channel". Posts as whichever person connected the account, not as a separate bot.',
    inputSchema,
    outputSchema,
    handler: async ({
      teamId,
      channel,
      message,
    }: {
      teamId: string;
      channel: string;
      message: string;
    }) => {
      try {
        const accessToken = await getValidTeamsAccessToken(
          organisationId,
          teamsIntegrationId,
        );
        await sendTeamsChannelMessage(accessToken, {
          teamId,
          channelId: channel,
          text: message,
        });
        return toolSuccess({ sent: true });
      } catch (error) {
        return toolError(
          error instanceof Error
            ? error.message
            : "Failed to send Teams notification.",
        );
      }
    },
  };
}
