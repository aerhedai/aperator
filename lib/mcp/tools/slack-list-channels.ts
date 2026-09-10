import { z } from "zod";

import { getSlackUserToken } from "@/lib/integrations/integration-service";
import { listSlackChannels } from "@/lib/integrations/slack/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  maxResults: z.number().int().min(1).max(200).default(100),
};

const outputSchema = {
  channels: z.array(z.object({ id: z.string(), name: z.string() })),
};

/**
 * Read-only, never approval-gated. Lets an agent discover a channel id by
 * name before calling SLACK_POST_MESSAGE/SLACK_READ_CHANNEL_HISTORY,
 * rather than a human having to look it up manually.
 */
export function createSlackListChannelsTool(
  organisationId: string,
  slackIntegrationId?: string | null,
) {
  return {
    name: "SLACK_LIST_CHANNELS",
    description:
      "List the public and private channels in the connected Slack workspace.",
    inputSchema,
    outputSchema,
    handler: async ({ maxResults }: { maxResults: number }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "slack",
          slackIntegrationId,
          "SLACK_LIST_CHANNELS",
        );
        if (scopeError) return toolError(scopeError);

        const userToken = await getSlackUserToken(
          organisationId,
          slackIntegrationId,
        );
        if (!userToken) {
          return toolError(
            "Listing Slack channels needs the account's user permissions, which weren't granted when it was connected — reconnect Slack from Settings and approve the full permission set.",
          );
        }
        const channels = await listSlackChannels(userToken, maxResults);
        return toolSuccess({ channels });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
