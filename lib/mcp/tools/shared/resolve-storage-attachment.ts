import { z } from "zod";

import { resolveAndDownloadFile as resolveAndDownloadDriveFile } from "@/lib/integrations/google-drive/client";
import {
  getValidGoogleDriveAccessToken,
  getValidSharePointAccessToken,
} from "@/lib/integrations/integration-service";
import {
  resolveAndDownloadFile as resolveAndDownloadSharePointFile,
  resolveDefaultDriveId,
  resolveSite,
} from "@/lib/integrations/sharepoint/client";

// Shared by GMAIL_SEND_EMAIL and OUTLOOK_SEND_EMAIL — not a branching tool
// itself, just a helper both genuinely need. Which storage provider an
// attachment lives in (Google Drive vs. SharePoint) is a different axis
// from which email provider is sending it, so this isn't the kind of
// cross-provider branching the provider-specific tool split was meant to
// eliminate — duplicating this into both files would just be the same
// logic twice, not two clean provider-specific implementations.
export const attachmentRefSchema = z.object({
  provider: z.enum(["google-drive", "sharepoint"]),
  siteName: z
    .string()
    .optional()
    .describe("Required when provider is sharepoint."),
  path: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Folder path segments ending in the filename, e.g. ["1042", "Quotation", "quote-final.pdf"]',
    ),
  mimeType: z.string().min(1),
});

export async function resolveStorageAttachment(
  organisationId: string,
  ref: z.infer<typeof attachmentRefSchema>,
): Promise<{ filename: string; mimeType: string; content: Buffer }> {
  const filename = ref.path.at(-1) as string;
  if (ref.provider === "google-drive") {
    const accessToken = await getValidGoogleDriveAccessToken(organisationId);
    const content = await resolveAndDownloadDriveFile(accessToken, ref.path);
    return { filename, mimeType: ref.mimeType, content };
  }
  if (!ref.siteName) {
    throw new Error(
      "siteName is required when an attachment's provider is sharepoint.",
    );
  }
  const accessToken = await getValidSharePointAccessToken(organisationId);
  const site = await resolveSite(accessToken, ref.siteName);
  if (!site) {
    throw new Error(`No SharePoint site matching "${ref.siteName}" was found.`);
  }
  const driveId = await resolveDefaultDriveId(accessToken, site.id);
  const content = await resolveAndDownloadSharePointFile(
    accessToken,
    driveId,
    ref.path,
  );
  return { filename, mimeType: ref.mimeType, content };
}
