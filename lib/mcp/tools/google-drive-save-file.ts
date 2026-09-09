import { z } from "zod";

import {
  ensureFolderPath,
  uploadOrReplaceFile,
} from "@/lib/integrations/google-drive/client";
import { getValidGoogleDriveAccessToken } from "@/lib/integrations/integration-service";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  path: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Folder path segments (not including the filename), e.g. ["1042"]',
    ),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  contentBase64: z.string().min(1),
  // true: overwrite any existing file of this exact name in this folder
  // rather than creating a second one — e.g. "keep only the latest
  // correspondence." false (default): always create a new file, the right
  // choice for attachments, which should accumulate.
  replace: z.boolean().default(false),
};

const outputSchema = {
  fileId: z.string(),
};

/**
 * The write counterpart to GOOGLE_DRIVE_CREATE_FOLDER for file *content*
 * specifically. Ensures the folder path exists itself (same find-or-create
 * semantics), so this is usable on its own, not only after a separate
 * GOOGLE_DRIVE_CREATE_FOLDER call. Not approval-gated — same class as
 * GOOGLE_DRIVE_CREATE_FOLDER and the record write tools.
 */
export function createGoogleDriveSaveFileTool(organisationId: string) {
  return {
    name: "GOOGLE_DRIVE_SAVE_FILE",
    description:
      "Save a file into the business's connected Google Drive, creating the folder path if needed. Set replace to overwrite an existing same-named file instead of creating a duplicate.",
    inputSchema,
    outputSchema,
    handler: async ({
      path,
      filename,
      mimeType,
      contentBase64,
      replace,
    }: {
      path: string[];
      filename: string;
      mimeType: string;
      contentBase64: string;
      replace: boolean;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "google-drive",
          undefined,
          "GOOGLE_DRIVE_SAVE_FILE",
        );
        if (scopeError) return toolError(scopeError);

        const content = Buffer.from(contentBase64, "base64");
        const accessToken =
          await getValidGoogleDriveAccessToken(organisationId);
        const folderId = await ensureFolderPath(accessToken, path);
        const file = await uploadOrReplaceFile(
          accessToken,
          folderId,
          filename,
          mimeType,
          content,
          replace,
        );
        return toolSuccess({ fileId: file.id });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
