import { z } from "zod";

import { findOutlookContacts } from "@/lib/integrations/outlook/client";
import { getValidOutlookAccessToken } from "@/lib/integrations/integration-service";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "A name or email address to search the connected Outlook contacts for.",
    ),
  maxResults: z.number().int().min(1).max(25).default(10),
};

const outputSchema = {
  contacts: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      email: z.string().nullable(),
    }),
  ),
};

/**
 * Read-only, never approval-gated. Uses Contacts.ReadWrite — the same
 * scope OUTLOOK_CREATE_CONTACT writes with — which was requested but had
 * no tool using it at all until now.
 */
export function createOutlookFindContactTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "OUTLOOK_FIND_CONTACT",
    description:
      "Search the connected Outlook account's contacts by name or email address.",
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
          "outlook",
          actionIntegrationId,
          "OUTLOOK_FIND_CONTACT",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidOutlookAccessToken(
          organisationId,
          actionIntegrationId,
        );
        const contacts = await findOutlookContacts(
          accessToken,
          query,
          maxResults,
        );
        return toolSuccess({ contacts });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
