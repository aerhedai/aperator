import { z } from "zod";

import { createOutlookContact } from "@/lib/integrations/outlook/client";
import { getValidOutlookAccessToken } from "@/lib/integrations/integration-service";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  displayName: z.string().min(1),
  email: z.email(),
};

const outputSchema = {
  contactId: z.string(),
};

/**
 * Not approval-gated — a new contact is internal address-book data, never
 * seen outside the business and trivially deleted if wrong.
 */
export function createOutlookCreateContactTool(
  organisationId: string,
  actionIntegrationId?: string | null,
) {
  return {
    name: "OUTLOOK_CREATE_CONTACT",
    description:
      "Add a new contact to the connected Outlook account's address book.",
    inputSchema,
    outputSchema,
    handler: async ({
      displayName,
      email,
    }: {
      displayName: string;
      email: string;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "outlook",
          actionIntegrationId,
          "OUTLOOK_CREATE_CONTACT",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidOutlookAccessToken(
          organisationId,
          actionIntegrationId,
        );
        const contact = await createOutlookContact(accessToken, {
          displayName,
          email,
        });
        return toolSuccess({ contactId: contact.id });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
