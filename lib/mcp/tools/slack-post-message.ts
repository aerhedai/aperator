import { z } from "zod";

import { getSlackBotToken } from "@/lib/integrations/integration-service";
import { postSlackMessage } from "@/lib/integrations/slack/client";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  channel: z.string().min(1).describe('The channel name or id, e.g. "#ops".'),
  message: z.string().min(1).describe("The message text to post"),
};

const outputSchema = {
  sent: z.boolean(),
};

/**
 * organisationId/slackIntegrationId bound at server-construction time,
 * never a tool argument (CLAUDE.md §22). Deliberately kept separate from
 * GMAIL_SEND_EMAIL/OUTLOOK_SEND_EMAIL despite both being "send a message":
 * an internal chat notification and an outbound customer email are
 * different *consequence* classes, and the policy engine gates them
 * differently (email requires approval, this does not) — see
 * lib/policies/policy-engine.ts.
 */
export function createSlackPostMessageTool(
  organisationId: string,
  slackIntegrationId?: string | null,
) {
  return {
    name: "SLACK_POST_MESSAGE",
    description:
      "Post an internal notification to a Slack channel, e.g. to alert a human that something needs attention.",
    inputSchema,
    outputSchema,
    handler: async ({
      channel,
      message,
    }: {
      channel: string;
      message: string;
    }) => {
      try {
        const botToken = await getSlackBotToken(
          organisationId,
          slackIntegrationId,
        );
        await postSlackMessage(botToken, { channel, text: message });
        return toolSuccess({ sent: true });
      } catch (error) {
        return toolError(
          error instanceof Error
            ? error.message
            : "Failed to send Slack notification.",
        );
      }
    },
  };
}
