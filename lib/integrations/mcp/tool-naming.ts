// A tool discovered from an external MCP server's tools/list response —
// cached on the owning Integration row's config.tools. readOnlyHint comes
// straight from the remote server's own (untrusted, per the MCP spec's own
// warning) annotations — used only to relax the approval gate, never to
// grant anything that wasn't already explicitly granted.
export interface DiscoveredMcpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  readOnlyHint: boolean | null;
}

// Double underscore, not a colon: a colon is rejected outright by the MCP
// SDK's own tool-name validator (letters/digits/underscore/dash/dot only —
// see node_modules/@modelcontextprotocol/sdk's toolNameValidation.js) and
// by Gemini's and OpenAI-compatible providers' function-calling APIs, which
// 400 the *entire* tool list (not just this one tool) the moment one name
// contains a colon. `Integration.id` is a Prisma cuid — lowercase letters
// and digits only, never an underscore — so "__" can never appear inside it,
// which is what makes a positional split safe below.
const PREFIX = "mcp__";
const SEPARATOR = "__";

// Both Gemini and OpenAI-compatible function-calling APIs cap tool/function
// names at 64 characters. A cuid (~25 chars) plus PREFIX and SEPARATOR
// overhead leaves a real but limited budget for the remote tool name
// portion — long remote names must be truncated to fit, never silently
// dropped or left to exceed the limit.
export const MAX_TOOL_NAME_LENGTH = 64;

// Excludes "." even though MCP and Gemini both allow it: OpenAI-compatible
// function-calling (which OpenRouter forwards tool names into verbatim,
// see lib/ai/providers/openrouter-provider.ts) validates against
// ^[a-zA-Z0-9_-]{1,64}$ — no dot. A remote tool named e.g. "jira.issue.get"
// would otherwise reproduce the exact failure class this file exists to
// prevent (a rejected tool list failing the whole run) on that provider.
const DISALLOWED_CHARS_REGEX = /[^A-Za-z0-9_-]/g;

function sanitize(value: string): string {
  return value.replace(DISALLOWED_CHARS_REGEX, "_");
}

// Not cryptographic — just cheap and stable, so two different long remote
// tool names that truncate to the same prefix don't collide once shortened.
function shortHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

/**
 * Encodes a remote tool name into whatever budget remains after the fixed
 * `mcp__<integrationId>__` prefix, so the full built name never exceeds
 * MAX_TOOL_NAME_LENGTH. Most remote tool names are short and pass through
 * untouched (just sanitized to the MCP-safe character set); a long one is
 * truncated with a short hash of the *original* name appended, so two
 * different long names sharing a truncated prefix don't collide.
 *
 * This same function is used both to build a name (buildMcpToolName below)
 * and to match a cached tool back against a name parsed off an
 * already-built one (integration-service.ts's findMcpTool) — using one
 * function for both directions is what keeps the round trip correct even
 * when truncation happened, without needing to store anything extra on the
 * Integration row.
 */
export function encodeRemoteToolName(
  integrationId: string,
  remoteToolName: string,
): string {
  const sanitized = sanitize(remoteToolName);
  const overhead = PREFIX.length + integrationId.length + SEPARATOR.length;
  const budget = MAX_TOOL_NAME_LENGTH - overhead;

  if (sanitized.length <= budget) return sanitized;

  const hashSuffix = `-${shortHash(remoteToolName)}`;
  const truncatedLength = Math.max(0, budget - hashSuffix.length);
  return `${sanitized.slice(0, truncatedLength)}${hashSuffix}`;
}

export function buildMcpToolName(
  integrationId: string,
  remoteToolName: string,
): string {
  const name = `${PREFIX}${integrationId}${SEPARATOR}${encodeRemoteToolName(integrationId, remoteToolName)}`;
  // A guard, not an expected path: encodeRemoteToolName's budget arithmetic
  // is what actually keeps this under the limit for any integrationId of
  // realistic (cuid) length. If some future integrationId shape ever broke
  // that arithmetic, failing loudly here beats silently handing Gemini/
  // OpenAI a name that will 400 the entire tool list.
  if (name.length > MAX_TOOL_NAME_LENGTH) {
    throw new Error(
      `Built MCP tool name "${name}" exceeds the ${MAX_TOOL_NAME_LENGTH}-character limit enforced by Gemini/OpenAI-compatible providers.`,
    );
  }
  return name;
}

export function parseMcpToolName(
  toolName: string,
): { integrationId: string; remoteToolName: string } | null {
  if (!toolName.startsWith(PREFIX)) return null;
  const rest = toolName.slice(PREFIX.length);
  // remoteToolName's *encoded* form may itself contain "__" (sanitize()
  // preserves underscores), so this splits on the first occurrence after
  // the prefix rather than assuming the encoded remote name never contains
  // the separator sequence — safe because integrationId (a cuid) never
  // contains "__" itself, so the first occurrence is always the real
  // boundary.
  const separatorIndex = rest.indexOf(SEPARATOR);
  if (separatorIndex === -1) return null;
  const integrationId = rest.slice(0, separatorIndex);
  const remoteToolName = rest.slice(separatorIndex + SEPARATOR.length);
  if (integrationId.length === 0 || remoteToolName.length === 0) return null;
  return { integrationId, remoteToolName };
}
