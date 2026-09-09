import { z } from "zod";

import {
  ensureFolderPath,
  resolveAndDownloadFile,
  uploadOrReplaceFile,
} from "@/lib/integrations/google-drive/client";
import { getValidGoogleDriveAccessToken } from "@/lib/integrations/integration-service";
import {
  DOCX_MIME_TYPE,
  renderDocxTemplate,
} from "@/lib/mcp/tools/shared/render-docx-template";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";
import { translateScopeError } from "@/lib/mcp/tools/shared/translate-scope-error";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

const inputSchema = {
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
 * connected Google Drive, not something this app authors. Not
 * approval-gated: producing a document isn't itself customer-visible until
 * something (e.g. GMAIL_SEND_EMAIL) actually sends it — same reasoning as
 * GOOGLE_DRIVE_CREATE_FOLDER.
 */
export function createGoogleDrivePopulateTemplateTool(organisationId: string) {
  return {
    name: "GOOGLE_DRIVE_POPULATE_TEMPLATE",
    description:
      "Fill a business's .docx quote template (with {field} placeholders) with real data and save the result to their connected Google Drive.",
    inputSchema,
    outputSchema,
    handler: async ({
      templatePath,
      outputPath,
      outputFilename,
      data,
      replace,
    }: {
      templatePath: string[];
      outputPath: string[];
      outputFilename: string;
      data: Record<string, unknown>;
      replace: boolean;
    }) => {
      try {
        const scopeError = await ensureScopeAvailable(
          organisationId,
          "google-drive",
          undefined,
          "GOOGLE_DRIVE_POPULATE_TEMPLATE",
        );
        if (scopeError) return toolError(scopeError);

        const accessToken =
          await getValidGoogleDriveAccessToken(organisationId);
        const template = await resolveAndDownloadFile(
          accessToken,
          templatePath,
        );
        const populated = renderDocxTemplate(template, data);
        const folderId = await ensureFolderPath(accessToken, outputPath);
        const file = await uploadOrReplaceFile(
          accessToken,
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
