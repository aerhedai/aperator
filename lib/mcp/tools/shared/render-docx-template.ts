import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

// Shared by GOOGLE_DRIVE_POPULATE_TEMPLATE and SHAREPOINT_POPULATE_TEMPLATE
// — genuinely provider-agnostic (operates on a .docx buffer already
// downloaded from whichever storage provider), not the kind of
// cross-provider branching the tool split was meant to eliminate.
// docxtemplater's default {tag} delimiter matches the same {field}
// convention already used for template interpolation elsewhere in this
// pipeline family (see entity-status-signal-pipeline.ts's interpolate
// helper), so a business configuring a document template and configuring
// an email subject/body template both use the same, single syntax.
export function renderDocxTemplate(
  template: Buffer,
  data: Record<string, unknown>,
): Buffer {
  const zip = new PizZip(template);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
}

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
