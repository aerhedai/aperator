import { z } from "zod";

import { ensureFolderPath } from "@/lib/integrations/google-drive/client";
import { getValidGoogleDriveAccessToken } from "@/lib/integrations/integration-service";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
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
 * Not approval-gated: creating a folder is not itself customer-visible or
 * consequential the way GMAIL_SEND_EMAIL/OUTLOOK_CREATE_CALENDAR_EVENT are
 * (see policy-engine.ts) — same class as the custom-entity write tools.
 */
export function createGoogleDriveCreateFolderTool(organisationId: string) {
  return {
    name: "GOOGLE_DRIVE_CREATE_FOLDER",
    description:
      "Create (or reuse, if it already exists) a nested folder path in the business's connected Google Drive.",
    inputSchema,
    outputSchema,
    handler: async ({ path }: { path: string[] }) => {
      try {
        const accessToken =
          await getValidGoogleDriveAccessToken(organisationId);
        const folderId = await ensureFolderPath(accessToken, path);
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
