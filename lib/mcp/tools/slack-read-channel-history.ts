import { z } from "zod";

import { getSlackUserToken } from "@/lib/integrations/integration-service";
import { readSlackChannelHistory } from "@/lib/integrations/slack/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  channel: z
    .string()
    .min(1)
    .describe("A channel id, as returned by SLACK_LIST_CHANNELS."),
  maxResults: z.number().int().min(1).max(100).default(20),
};

const outputSchema = {
  messages: z.array(
    z.object({
      user: z.string().nullable(),
      text: z.string(),
      ts: z.string(),
    }),
  ),
};

/**
 * Read-only, never approval-gated. SLACK_POST_MESSAGE's read counterpart
 * — lets an agent see a channel's recent conversation before deciding
 * whether/what to post.
 */
export function createSlackReadChannelHistoryTool(
  organisationId: string,
  slackIntegrationId?: string | null,
) {
  return {
    name: "SLACK_READ_CHANNEL_HISTORY",
    description:
      "Read recent messages from a Slack channel, most recent first.",
    inputSchema,
    outputSchema,
    handler: async ({
      channel,
      maxResults,
    }: {
      channel: string;
      maxResults: number;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "slack",
          slackIntegrationId,
          "SLACK_READ_CHANNEL_HISTORY",
        );
        if (scopeError) return toolError(scopeError);

        const userToken = await getSlackUserToken(
          organisationId,
          slackIntegrationId,
        );
        if (!userToken) {
          return toolError(
            "Reading Slack channel history needs the account's user permissions, which weren't granted when it was connected — reconnect Slack from Settings and approve the full permission set.",
          );
        }
        const messages = await readSlackChannelHistory(
          userToken,
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
