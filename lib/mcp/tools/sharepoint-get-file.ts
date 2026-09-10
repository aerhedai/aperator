import { z } from "zod";

import { getValidSharePointAccessToken } from "@/lib/integrations/integration-service";
import {
  downloadFileContent,
  getFileMetadata,
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
  name: z.string(),
  contentBase64: z.string(),
};

/**
 * Read-only, never approval-gated. The read counterpart to
 * SHAREPOINT_SAVE_FILE — fetches a specific already-known file's actual
 * content, not just its metadata.
 */
export function createSharePointGetFileTool(organisationId: string) {
  return {
    name: "SHAREPOINT_GET_FILE",
    description:
      "Fetch a specific file's content from a connected SharePoint site, given its id.",
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
          "SHAREPOINT_GET_FILE",
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
        const [metadata, content] = await Promise.all([
          getFileMetadata(accessToken, driveId, fileId),
          downloadFileContent(accessToken, driveId, fileId),
        ]);
        return toolSuccess({
          name: metadata.name,
          contentBase64: content.toString("base64"),
        });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
