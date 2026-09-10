import { z } from "zod";

import { getSlackUserToken } from "@/lib/integrations/integration-service";
import { getSlackUserInfo } from "@/lib/integrations/slack/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  userId: z
    .string()
    .min(1)
    .describe("A Slack user id, e.g. as seen on a message's `user` field."),
};

const outputSchema = {
  id: z.string(),
  realName: z.string().nullable(),
  email: z.string().nullable(),
};

/**
 * Read-only, never approval-gated. Turns a Slack user id (all a message
 * or channel history exposes) into a name/email an agent can actually
 * act on — e.g. matching a Slack poster to a business's own contact.
 */
export function createSlackGetUserInfoTool(
  organisationId: string,
  slackIntegrationId?: string | null,
) {
  return {
    name: "SLACK_GET_USER_INFO",
    description:
      "Look up a Slack user's display name and email address by their user id.",
    inputSchema,
    outputSchema,
    handler: async ({ userId }: { userId: string }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "slack",
          slackIntegrationId,
          "SLACK_GET_USER_INFO",
        );
        if (scopeError) return toolError(scopeError);

        const userToken = await getSlackUserToken(
          organisationId,
          slackIntegrationId,
        );
        if (!userToken) {
          return toolError(
            "Looking up Slack users needs the account's user permissions, which weren't granted when it was connected — reconnect Slack from Settings and approve the full permission set.",
          );
        }
        const info = await getSlackUserInfo(userToken, userId);
        return toolSuccess({
          id: info.id,
          realName: info.realName,
          email: info.email,
        });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
