import { z } from "zod";

import { getValidSharePointAccessToken } from "@/lib/integrations/integration-service";
import {
  ensureFolderPath,
  resolveAndDownloadFile,
  resolveDefaultDriveId,
  resolveSite,
  uploadOrReplaceFile,
} from "@/lib/integrations/sharepoint/client";
import {
  DOCX_MIME_TYPE,
  renderDocxTemplate,
} from "@/lib/mcp/tools/shared/render-docx-template";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
  siteName: z.string().min(1).describe("The SharePoint site to resolve."),
  templatePath: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Path (ending in the filename) to a .docx template with {field} placeholders, e.g. ["Templates", "quote-template.docx"]',
    ),
  outputPath: z
    .array(z.string().min(1))
    .min(1)
    .describe("Folder path to save the populated document into."),
  outputFilename: z.string().min(1),
  data: z
    .record(z.string(), z.unknown())
    .describe("Values for the template's {field} placeholders"),
  replace: z
    .boolean()
    .default(false)
    .describe(
      "Overwrite an existing same-named output file instead of duplicating it.",
    ),
};

const outputSchema = {
  fileId: z.string(),
};

/**
 * A business's quote template lives as a real .docx file in its own
 * connected SharePoint site — same reasoning as
 * GOOGLE_DRIVE_POPULATE_TEMPLATE's own comment.
 */
export function createSharePointPopulateTemplateTool(organisationId: string) {
  return {
    name: "SHAREPOINT_POPULATE_TEMPLATE",
    description:
      "Fill a business's .docx quote template (with {field} placeholders) with real data and save the result to their connected SharePoint site.",
    inputSchema,
    outputSchema,
    handler: async ({
      siteName,
      templatePath,
      outputPath,
      outputFilename,
      data,
      replace,
    }: {
      siteName: string;
      templatePath: string[];
      outputPath: string[];
      outputFilename: string;
      data: Record<string, unknown>;
      replace: boolean;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "sharepoint",
          undefined,
          "SHAREPOINT_POPULATE_TEMPLATE",
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
        const template = await resolveAndDownloadFile(
          accessToken,
          driveId,
          templatePath,
        );
        const populated = renderDocxTemplate(template, data);
        const folderId = await ensureFolderPath(
          accessToken,
          driveId,
          outputPath,
        );
        const file = await uploadOrReplaceFile(
          accessToken,
          driveId,
          folderId,
          outputFilename,
          DOCX_MIME_TYPE,
          populated,
          replace,
        );
        return toolSuccess({ fileId: file.id });
      } catch (error) {
        return toolError(translateScopeError(error));
      }
    },
  };
}
