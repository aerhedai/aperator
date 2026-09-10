import { z } from "zod";

import { searchFiles } from "@/lib/integrations/google-drive/client";
import { getValidGoogleDriveAccessToken } from "@/lib/integrations/integration-service";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Text to search for in file names and, where supported, content.",
    ),
  maxResults: z.number().int().min(1).max(50).default(10),
};

const outputSchema = {
  files: z.array(
    z.object({ id: z.string(), name: z.string(), mimeType: z.string() }),
  ),
};

/**
 * Read-only, never approval-gated. Finds a file by content/name rather
 * than requiring the exact folder path GOOGLE_DRIVE_SAVE_FILE/
 * GOOGLE_DRIVE_POPULATE_TEMPLATE need — the "find the file about X"
 * counterpart to those tools' "I already know exactly where it goes."
 */
export function createGoogleDriveSearchFilesTool(organisationId: string) {
  return {
    name: "GOOGLE_DRIVE_SEARCH_FILES",
    description:
      "Search the business's connected Google Drive by file name or content.",
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
          "google-drive",
          undefined,
          "GOOGLE_DRIVE_SEARCH_FILES",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken =
          await getValidGoogleDriveAccessToken(organisationId);
        const files = await searchFiles(accessToken, query, maxResults);
        return toolSuccess({ files });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
