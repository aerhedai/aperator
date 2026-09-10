import { z } from "zod";

import { getValidSharePointAccessToken } from "@/lib/integrations/integration-service";
import {
  deleteFile,
  resolveDefaultDriveId,
  resolveSite,
} from "@/lib/integrations/sharepoint/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  siteName: z.string().min(1).describe("The SharePoint site to resolve."),
  fileId: z
    .string()
    .min(1)
    .describe(
      "A file id, as returned by SHAREPOINT_SEARCH_FILES/SHAREPOINT_LIST_FOLDER.",
    ),
};

const outputSchema = {
  deleted: z.boolean(),
};

/**
 * Approval-gated — same reasoning as GOOGLE_DRIVE_DELETE_FILE: even
 * though this lands in the site's Recycle Bin rather than being
 * permanently destroyed, removing a file from where a business expects
 * to find it warrants a human confirming first.
 */
export function createSharePointDeleteFileTool(organisationId: string) {
  return {
    name: "SHAREPOINT_DELETE_FILE",
    description:
      "Delete a file from a connected SharePoint site's document library (recoverable from the site's Recycle Bin) — always requires approval.",
    inputSchema,
    outputSchema,
    handler: async ({
      siteName,
      fileId,
    }: {
      siteName: string;
      fileId: string;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "sharepoint",
          undefined,
          "SHAREPOINT_DELETE_FILE",
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
        await deleteFile(accessToken, driveId, fileId);
        return toolSuccess({ deleted: true });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
