import { z } from "zod";

import { getValidSharePointAccessToken } from "@/lib/integrations/integration-service";
import {
  listFolderChildren,
  resolveDefaultDriveId,
  resolveFolderPath,
  resolveSite,
} from "@/lib/integrations/sharepoint/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  siteName: z.string().min(1).describe("The SharePoint site to resolve."),
  path: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Folder path segments from the document library root — empty lists root itself.",
    ),
};

const outputSchema = {
  files: z.array(
    z.object({ id: z.string(), name: z.string(), isFolder: z.boolean() }),
  ),
};

/**
 * Read-only, never approval-gated. Fails clearly if the path doesn't
 * exist, same reasoning as GOOGLE_DRIVE_LIST_FOLDER.
 */
export function createSharePointListFolderTool(organisationId: string) {
  return {
    name: "SHAREPOINT_LIST_FOLDER",
    description:
      "List the files and subfolders directly inside a folder path in a connected SharePoint site's document library.",
    inputSchema,
    outputSchema,
    handler: async ({
      siteName,
      path,
    }: {
      siteName: string;
      path: string[];
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "sharepoint",
          undefined,
          "SHAREPOINT_LIST_FOLDER",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken = await getValidSharePointAccessToken(organisationId);
        const site = await resolveSite(accessToken, siteName);
        if (!site) {
          return toolError(
            `No SharePoint site matching "${siteName}" was found.`,
          );
        }
        const driveId = await resolveDefaultDriveId(accessToken, site.id);
        const folderItemId =
          path.length === 0
            ? "root"
            : await resolveFolderPath(accessToken, driveId, path);
        const files = await listFolderChildren(
          accessToken,
          driveId,
          folderItemId,
        );
        return toolSuccess({ files });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
