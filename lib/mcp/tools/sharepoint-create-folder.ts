import { z } from "zod";

import { getValidSharePointAccessToken } from "@/lib/integrations/integration-service";
import {
  ensureFolderPath,
  resolveDefaultDriveId,
  resolveSite,
} from "@/lib/integrations/sharepoint/client";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  siteName: z.string().min(1).describe("The SharePoint site to resolve."),
  path: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Folder path segments, top to bottom, e.g. ["1042", "Client correspondence"]',
    ),
};

const outputSchema = {
  folderId: z.string(),
};

/**
 * Not approval-gated — same reasoning as GOOGLE_DRIVE_CREATE_FOLDER's own
 * comment.
 */
export function createSharePointCreateFolderTool(organisationId: string) {
  return {
    name: "SHAREPOINT_CREATE_FOLDER",
    description:
      "Create (or reuse, if it already exists) a nested folder path in the business's connected SharePoint site.",
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
        const accessToken = await getValidSharePointAccessToken(organisationId);
        const site = await resolveSite(accessToken, siteName);
        if (!site) {
          return toolError(
            `No SharePoint site matching "${siteName}" was found.`,
          );
        }
        const driveId = await resolveDefaultDriveId(accessToken, site.id);
        const folderId = await ensureFolderPath(accessToken, driveId, path);
        return toolSuccess({ folderId });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to create storage folder.";
        return toolError(message);
      }
    },
  };
}
