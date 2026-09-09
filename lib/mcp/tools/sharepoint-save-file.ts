import { z } from "zod";

import { getValidSharePointAccessToken } from "@/lib/integrations/integration-service";
import {
  ensureFolderPath,
  resolveDefaultDriveId,
  resolveSite,
  uploadOrReplaceFile,
} from "@/lib/integrations/sharepoint/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  siteName: z.string().min(1).describe("The SharePoint site to resolve."),
  path: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Folder path segments (not including the filename), e.g. ["1042"]',
    ),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  contentBase64: z.string().min(1),
  replace: z.boolean().default(false),
};

const outputSchema = {
  fileId: z.string(),
};

/**
 * The write counterpart to SHAREPOINT_CREATE_FOLDER — same reasoning as
 * GOOGLE_DRIVE_SAVE_FILE's own comment.
 */
export function createSharePointSaveFileTool(organisationId: string) {
  return {
    name: "SHAREPOINT_SAVE_FILE",
    description:
      "Save a file into the business's connected SharePoint site, creating the folder path if needed. Set replace to overwrite an existing same-named file instead of creating a duplicate.",
    inputSchema,
    outputSchema,
    handler: async ({
      siteName,
      path,
      filename,
      mimeType,
      contentBase64,
      replace,
    }: {
      siteName: string;
      path: string[];
      filename: string;
      mimeType: string;
      contentBase64: string;
      replace: boolean;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "sharepoint",
          undefined,
          "SHAREPOINT_SAVE_FILE",
        );
        if (scopeError) return toolError(scopeError);

        const content = Buffer.from(contentBase64, "base64");
        const accessToken = await getValidSharePointAccessToken(organisationId);
        const site = await resolveSite(accessToken, siteName);
        if (!site) {
          return toolError(
            `No SharePoint site matching "${siteName}" was found.`,
          );
        }
        const driveId = await resolveDefaultDriveId(accessToken, site.id);
        const folderId = await ensureFolderPath(accessToken, driveId, path);
        const file = await uploadOrReplaceFile(
          accessToken,
          driveId,
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
