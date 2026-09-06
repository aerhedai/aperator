import type { AIProvider } from "@/lib/ai/provider";
import { GeminiProvider } from "@/lib/ai/providers/gemini-provider";
import { OllamaProvider } from "@/lib/ai/providers/ollama-provider";
import { OpenRouterProvider } from "@/lib/ai/providers/openrouter-provider";
import * as integrationRepository from "@/lib/integrations/integration-repository";
import * as integrationService from "@/lib/integrations/integration-service";
import * as organisationRepository from "@/lib/organisations/organisation-repository";

// An AI provider connection is a Connection like any other (CLAUDE.md
// §4.1) — an authenticated link to an external system, owned by one
// organisation — so each is stored as an ordinary Integration rather than
// a bespoke table. All three can be connected at once: switching which is
// active (below) doesn't discard the others' credentials, so toggling back
// costs nothing. Adding a fourth provider is another constant and another
// thin *ProviderInput/set*Provider pair here, not a new storage model —
// proven twice now, first by Gemini, then by OpenRouter reusing the exact
// same shape.
export const OLLAMA_PROVIDER = "ollama";
export const GEMINI_PROVIDER = "gemini";
export const OPENROUTER_PROVIDER = "openrouter";
export type AIProviderKind =
  typeof OLLAMA_PROVIDER | typeof GEMINI_PROVIDER | typeof OPENROUTER_PROVIDER;

// Only one connection per provider makes sense per organisation today —
// unlike Gmail/Slack, there's no "which one of several" concept yet (no
// Agent-level pin the way actionIntegrationId works for email/chat) — so
// every org's connection of a given provider is upserted under this fixed
// name rather than a business-chosen label. Reconnecting always updates
// the same row.
const CONNECTION_NAME = "Default";

export interface OllamaProviderInput {
  baseUrl: string;
  // Optional: only needed when baseUrl points at the auth proxy in
  // scripts/ollama-auth-proxy.py, not plain local Ollama (see
  // OllamaProvider's own constructor comment).
  //
  // undefined on an update means "leave whatever's already stored" — the
  // Settings form's password field is never pre-filled with a real secret
  // (nothing server-rendered echoes it back), so "the field was submitted
  // blank" can't be told apart from "the business chose not to change it"
  // without this convention. Pass an explicit empty string to clear it.
  proxySecret?: string;
}

export interface GeminiProviderInput {
  // Same undefined-means-unchanged convention as OllamaProviderInput's
  // proxySecret, for the same reason — this is the one and only secret
  // field, never echoed back to a form that's already been saved once.
  apiKey?: string;
}

export interface OpenRouterProviderInput {
  // Same undefined-means-unchanged convention as GeminiProviderInput.
  apiKey?: string;
}

export interface OrganisationAIConnection {
  connectedAt: Date;
  // Ollama-only, and deliberately shown: unlike an API key, a base URL
  // isn't secret, and seeing which host is currently configured is
  // genuinely useful before deciding whether to reconnect it. Undefined
  // for Gemini and OpenRouter — an API key has nothing non-secret worth
  // surfacing.
  baseUrl?: string;
}

/**
 * Every provider this organisation could be running on, in one call — what
 * Settings needs to render all three cards and show which is active
 * without a caller stitching several lookups together itself.
 */
export interface AIProviderStatus {
  active: AIProviderKind;
  ollama: OrganisationAIConnection | null;
  gemini: OrganisationAIConnection | null;
  openrouter: OrganisationAIConnection | null;
}

/**
 * Raised when an organisation has no AI provider connected. Every
 * organisation used to silently share one operator-configured Ollama
 * instance via a global env var — this is what closes that: an
 * organisation must explicitly connect its own provider before any agent
 * of theirs can run, no implicit fallback to anyone else's machine.
 */
export class AIProviderNotConfiguredError extends Error {
  constructor() {
    super(
      "No AI provider is connected for this organisation. Connect one in Settings → AI Provider.",
    );
    this.name = "AIProviderNotConfiguredError";
  }
}

export async function setOllamaProvider(
  organisationId: string,
  input: OllamaProviderInput,
): Promise<void> {
  let proxySecret: string | null;
  if (input.proxySecret === undefined) {
    const existing = await integrationService.getDefaultIntegrationByProvider(
      organisationId,
      OLLAMA_PROVIDER,
    );
    const existingSecret = existing?.credentials?.proxySecret;
    proxySecret = typeof existingSecret === "string" ? existingSecret : null;
  } else {
    proxySecret = input.proxySecret === "" ? null : input.proxySecret;
  }

  await integrationRepository.upsertIntegration(
    organisationId,
    OLLAMA_PROVIDER,
    CONNECTION_NAME,
    {
      config: {},
      credentials: { baseUrl: input.baseUrl, proxySecret },
    },
  );
}

export async function setGeminiProvider(
  organisationId: string,
  input: GeminiProviderInput,
): Promise<void> {
  let apiKey: string | null;
  if (input.apiKey === undefined) {
    const existing = await integrationService.getDefaultIntegrationByProvider(
      organisationId,
      GEMINI_PROVIDER,
    );
    const existingKey = existing?.credentials?.apiKey;
    apiKey = typeof existingKey === "string" ? existingKey : null;
  } else {
    apiKey = input.apiKey === "" ? null : input.apiKey;
  }
  if (!apiKey) {
    throw new Error("An API key is required to connect Gemini.");
  }

  await integrationRepository.upsertIntegration(
    organisationId,
    GEMINI_PROVIDER,
    CONNECTION_NAME,
    {
      config: {},
      credentials: { apiKey },
    },
  );
}

export async function setOpenRouterProvider(
  organisationId: string,
  input: OpenRouterProviderInput,
): Promise<void> {
  let apiKey: string | null;
  if (input.apiKey === undefined) {
    const existing = await integrationService.getDefaultIntegrationByProvider(
      organisationId,
      OPENROUTER_PROVIDER,
    );
    const existingKey = existing?.credentials?.apiKey;
    apiKey = typeof existingKey === "string" ? existingKey : null;
  } else {
    apiKey = input.apiKey === "" ? null : input.apiKey;
  }
  if (!apiKey) {
    throw new Error("An API key is required to connect OpenRouter.");
  }

  await integrationRepository.upsertIntegration(
    organisationId,
    OPENROUTER_PROVIDER,
    CONNECTION_NAME,
    {
      config: {},
      credentials: { apiKey },
    },
  );
}

export async function disconnectProvider(
  organisationId: string,
  provider: AIProviderKind,
): Promise<void> {
  const existing = await integrationService.getDefaultIntegrationByProvider(
    organisationId,
    provider,
  );
  if (existing) {
    await integrationService.disconnectIntegration(organisationId, existing.id);
  }
}

/**
 * Which provider actually runs this organisation's agents. Defaults to
 * Ollama for `null` — every organisation that predates this column, since
 * Ollama was the only provider that ever existed, so an org that's never
 * touched this setting keeps behaving exactly as before it existed.
 */
function resolveActiveProviderKind(
  activeAiProvider: string | null,
): AIProviderKind {
  if (activeAiProvider === GEMINI_PROVIDER) return GEMINI_PROVIDER;
  if (activeAiProvider === OPENROUTER_PROVIDER) return OPENROUTER_PROVIDER;
  return OLLAMA_PROVIDER;
}

function providerLabel(provider: AIProviderKind): string {
  if (provider === GEMINI_PROVIDER) return "Gemini";
  if (provider === OPENROUTER_PROVIDER) return "OpenRouter";
  return "Ollama";
}

/**
 * Makes a provider active. Refuses to activate one with nothing connected
 * — surfaced as a real error rather than silently activating a provider
 * every subsequent run would fail against (CLAUDE.md §14).
 */
export async function setActiveProvider(
  organisationId: string,
  provider: AIProviderKind,
): Promise<void> {
  const integration = await integrationService.getDefaultIntegrationByProvider(
    organisationId,
    provider,
  );
  if (!integration) {
    throw new Error(
      `Connect ${providerLabel(provider)} first, then make it active.`,
    );
  }
  await organisationRepository.setActiveAiProvider(organisationId, provider);
}

/**
 * Both connections' status plus which is active, for Settings to render in
 * one pass. Credentials never leave this module — only whether a
 * connection exists and when it was last saved.
 */
export async function getAIProviderStatus(
  organisationId: string,
  activeAiProvider: string | null,
): Promise<AIProviderStatus> {
  const [ollama, gemini, openrouter] = await Promise.all([
    integrationService.getDefaultIntegrationByProvider(
      organisationId,
      OLLAMA_PROVIDER,
    ),
    integrationService.getDefaultIntegrationByProvider(
      organisationId,
      GEMINI_PROVIDER,
    ),
    integrationService.getDefaultIntegrationByProvider(
      organisationId,
      OPENROUTER_PROVIDER,
    ),
  ]);
  const ollamaBaseUrl = ollama?.credentials?.baseUrl;
  return {
    active: resolveActiveProviderKind(activeAiProvider),
    ollama: ollama
      ? {
          connectedAt: ollama.updatedAt,
          ...(typeof ollamaBaseUrl === "string" && { baseUrl: ollamaBaseUrl }),
        }
      : null,
    gemini: gemini ? { connectedAt: gemini.updatedAt } : null,
    openrouter: openrouter ? { connectedAt: openrouter.updatedAt } : null,
  };
}

/**
 * The one place that turns "this organisation's active AI provider" into a
 * real AIProvider instance the runtime can call. Every caller in
 * lib/runtime/, lib/harness/ and lib/routing/ takes provider as a required
 * parameter (no default) precisely so this resolution happens once, at a
 * real request boundary, with a real organisationId — never buried behind
 * an implicit global fallback.
 */
export async function getAIProvider(
  organisationId: string,
): Promise<AIProvider> {
  const organisation =
    await organisationRepository.findOrganisationById(organisationId);
  const activeProvider = resolveActiveProviderKind(
    organisation?.activeAiProvider ?? null,
  );

  const integration = await integrationService.getDefaultIntegrationByProvider(
    organisationId,
    activeProvider,
  );
  if (!integration) {
    throw new AIProviderNotConfiguredError();
  }

  if (activeProvider === GEMINI_PROVIDER) {
    const apiKey = integration.credentials?.apiKey;
    if (typeof apiKey !== "string") {
      throw new AIProviderNotConfiguredError();
    }
    return new GeminiProvider(apiKey);
  }

  if (activeProvider === OPENROUTER_PROVIDER) {
    const apiKey = integration.credentials?.apiKey;
    if (typeof apiKey !== "string") {
      throw new AIProviderNotConfiguredError();
    }
    return new OpenRouterProvider(apiKey);
  }

  const baseUrl = integration.credentials?.baseUrl;
  if (typeof baseUrl !== "string") {
    throw new AIProviderNotConfiguredError();
  }
  const proxySecret = integration.credentials?.proxySecret;
  return new OllamaProvider(
    baseUrl,
    typeof proxySecret === "string" ? proxySecret : undefined,
  );
}
