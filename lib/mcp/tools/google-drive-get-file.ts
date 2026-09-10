import { z } from "zod";

import {
  downloadFile,
  getFileMetadata,
} from "@/lib/integrations/google-drive/client";
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
  name: z.string(),
  mimeType: z.string(),
  contentBase64: z.string(),
};

/**
 * Read-only, never approval-gated. The read counterpart to
 * GOOGLE_DRIVE_SAVE_FILE — fetches a specific already-known file's actual
 * content, not just its metadata.
 */
export function createGoogleDriveGetFileTool(organisationId: string) {
  return {
    name: "GOOGLE_DRIVE_GET_FILE",
    description:
      "Fetch a specific file's content and metadata from the business's connected Google Drive, given its id.",
    inputSchema,
    outputSchema,
    handler: async ({ fileId }: { fileId: string }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "google-drive",
          undefined,
          "GOOGLE_DRIVE_GET_FILE",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken =
          await getValidGoogleDriveAccessToken(organisationId);
        const [metadata, content] = await Promise.all([
          getFileMetadata(accessToken, fileId),
          downloadFile(accessToken, fileId),
        ]);
        return toolSuccess({
          name: metadata.name,
          mimeType: metadata.mimeType,
          contentBase64: content.toString("base64"),
        });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
