import { z } from "zod";

import {
  listFolderChildren,
  resolveFolderPath,
} from "@/lib/integrations/google-drive/client";
import { getValidGoogleDriveAccessToken } from "@/lib/integrations/integration-service";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  path: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Folder path segments from Drive root — empty lists root itself.",
    ),
};

const outputSchema = {
  files: z.array(
    z.object({ id: z.string(), name: z.string(), mimeType: z.string() }),
  ),
};

/**
 * Read-only, never approval-gated. Fails clearly if the path doesn't
 * exist rather than creating it — unlike GOOGLE_DRIVE_CREATE_FOLDER,
 * which is meant to be idempotent, a mistyped path here is a real mistake
 * worth surfacing.
 */
export function createGoogleDriveListFolderTool(organisationId: string) {
  return {
    name: "GOOGLE_DRIVE_LIST_FOLDER",
    description:
      "List the files and subfolders directly inside a folder path in the business's connected Google Drive.",
    inputSchema,
    outputSchema,
    handler: async ({ path }: { path: string[] }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "google-drive",
          undefined,
          "GOOGLE_DRIVE_LIST_FOLDER",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken =
          await getValidGoogleDriveAccessToken(organisationId);
        const folderId =
          path.length === 0
            ? "root"
            : await resolveFolderPath(accessToken, path);
        const files = await listFolderChildren(accessToken, folderId);
        return toolSuccess({ files });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
