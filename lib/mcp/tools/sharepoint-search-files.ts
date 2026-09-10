import { z } from "zod";

import { getValidSharePointAccessToken } from "@/lib/integrations/integration-service";
import {
  resolveDefaultDriveId,
  resolveSite,
  searchFiles,
} from "@/lib/integrations/sharepoint/client";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  siteName: z.string().min(1).describe("The SharePoint site to resolve."),
  query: z
    .string()
    .min(1)
    .describe(
      "Text to search for in file names and, where supported, content.",
    ),
  maxResults: z.number().int().min(1).max(50).default(10),
};

const outputSchema = {
  files: z.array(
    z.object({ id: z.string(), name: z.string(), isFolder: z.boolean() }),
  ),
};

/**
 * Read-only, never approval-gated. The Drive counterpart is
 * GOOGLE_DRIVE_SEARCH_FILES.
 */
export function createSharePointSearchFilesTool(organisationId: string) {
  return {
    name: "SHAREPOINT_SEARCH_FILES",
    description:
      "Search a connected SharePoint site's document library by file name or content.",
    inputSchema,
    outputSchema,
    handler: async ({
      siteName,
      query,
      maxResults,
    }: {
      siteName: string;
      query: string;
      maxResults: number;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "sharepoint",
          undefined,
          "SHAREPOINT_SEARCH_FILES",
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
        const files = await searchFiles(
          accessToken,
          driveId,
          query,
          maxResults,
        );
        return toolSuccess({ files });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
