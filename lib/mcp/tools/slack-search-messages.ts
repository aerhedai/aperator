import { z } from "zod";

import { getSlackUserToken } from "@/lib/integrations/integration-service";
import { searchSlackMessages } from "@/lib/integrations/slack/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  query: z
    .string()
    .min(1)
    .describe('Slack search syntax, e.g. "in:#general invoice".'),
  maxResults: z.number().int().min(1).max(50).default(10),
};

const outputSchema = {
  matches: z.array(
    z.object({
      channel: z.string().nullable(),
      user: z.string().nullable(),
      text: z.string(),
      permalink: z.string(),
    }),
  ),
};

/**
 * Read-only, never approval-gated. Needs the connected account's Slack
 * *user* token (search.messages has no bot-token equivalent) — declined
 * during connect (a real, allowed outcome), ensureScopeAvailable already
 * denies this before the null-token case is reached.
 */
export function createSlackSearchMessagesTool(
  organisationId: string,
  slackIntegrationId?: string | null,
) {
  return {
    name: "SLACK_SEARCH_MESSAGES",
    description:
      "Search messages across the connected Slack workspace using Slack's own search syntax.",
    inputSchema,
    outputSchema,
    handler: async ({
      query,
      maxResults,
    }: {
      query: string;
      maxResults: number;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "slack",
          slackIntegrationId,
          "SLACK_SEARCH_MESSAGES",
        );
        if (scopeError) return toolError(scopeError);

        const userToken = await getSlackUserToken(
          organisationId,
          slackIntegrationId,
        );
        if (!userToken) {
          return toolError(
            "Slack search needs the account's user permissions, which weren't granted when it was connected — reconnect Slack from Settings and approve the full permission set.",
          );
        }
        const matches = await searchSlackMessages(userToken, query, maxResults);
        return toolSuccess({ matches });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
