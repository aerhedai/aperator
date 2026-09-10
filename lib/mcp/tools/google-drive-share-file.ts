import { z } from "zod";

import { shareFile } from "@/lib/integrations/google-drive/client";
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
  email: z.email().describe("Who to grant access to."),
  role: z
    .enum(["reader", "commenter", "writer"])
    .default("reader")
    .describe("How much access to grant."),
};

const outputSchema = {
  shared: z.boolean(),
};

/**
 * Approval-gated: granting access to a file — especially to someone
 * outside the business — is exactly the kind of consequential,
 * hard-to-fully-undo action (once viewed, it's been seen) CLAUDE.md §4.6
 * describes. No amount threshold, no exceptions, same as an email send.
 */
export function createGoogleDriveShareFileTool(organisationId: string) {
  return {
    name: "GOOGLE_DRIVE_SHARE_FILE",
    description:
      "Grant an email address access to a file in the business's connected Google Drive — always requires approval.",
    inputSchema,
    outputSchema,
    handler: async ({
      fileId,
      email,
      role,
    }: {
      fileId: string;
      email: string;
      role: "reader" | "commenter" | "writer";
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "google-drive",
          undefined,
          "GOOGLE_DRIVE_SHARE_FILE",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken =
          await getValidGoogleDriveAccessToken(organisationId);
        await shareFile(accessToken, fileId, email, role);
        return toolSuccess({ shared: true });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
