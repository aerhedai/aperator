import { z } from "zod";

import { trashFile } from "@/lib/integrations/google-drive/client";
import { getValidGoogleDriveAccessToken } from "@/lib/integrations/integration-service";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  fileId: z
    .string()
    .min(1)
    .describe(
      "A file id, as returned by GOOGLE_DRIVE_SEARCH_FILES/GOOGLE_DRIVE_LIST_FOLDER.",
    ),
};

const outputSchema = {
  trashed: z.boolean(),
};

/**
 * Approval-gated: even though this moves a file to trash rather than
 * permanently deleting it (Drive's own retention window still applies),
 * removing a file from where a business expects to find it is
 * consequential enough — and easy enough to get wrong on a bad file id —
 * to warrant a human confirming first, same bar as an email send.
 */
export function createGoogleDriveDeleteFileTool(organisationId: string) {
  return {
    name: "GOOGLE_DRIVE_DELETE_FILE",
    description:
      "Move a file to trash in the business's connected Google Drive — always requires approval.",
    inputSchema,
    outputSchema,
    handler: async ({ fileId }: { fileId: string }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "google-drive",
          undefined,
          "GOOGLE_DRIVE_DELETE_FILE",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken =
          await getValidGoogleDriveAccessToken(organisationId);
        await trashFile(accessToken, fileId);
        return toolSuccess({ trashed: true });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
