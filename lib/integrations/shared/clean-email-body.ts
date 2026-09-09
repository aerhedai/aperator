// Strips boilerplate that adds prompt tokens without adding information —
// deliberately conservative, only unambiguous patterns. Never touches
// quoted/forwarded content: live testing (Phase 9) showed a customer's
// actual request can be sitting inside a forwarded block ("Begin forwarded
// message: ... Hi, can you provide a quote..."), so stripping anything that
// merely *looks* like quoting risks silently dropping the real request — a
// correctness bug, which is a far worse outcome than a few extra tokens.
const SIGNATURE_DELIMITER = /\n--\s*\n[\s\S]*$/;

const MOBILE_CLIENT_FOOTERS = [
  /\n?Sent from my iPhone\s*$/im,
  /\n?Sent from my iPad\s*$/im,
  /\n?Sent from my Android.*$/im,
  /\n?Get Outlook for (iOS|Android)\s*$/im,
];

export function cleanEmailBody(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n");

  text = text.replace(SIGNATURE_DELIMITER, "");
  for (const pattern of MOBILE_CLIENT_FOOTERS) {
    text = text.replace(pattern, "");
  }

  // Collapse runs of 3+ blank lines to one — pure whitespace, zero
  // information, but still costs tokens.
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
