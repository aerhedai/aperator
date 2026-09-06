import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  AIProviderNotConfiguredError,
  disconnectProvider,
  getAIProvider,
  getAIProviderStatus,
  setActiveProvider,
  setGeminiProvider,
  setOllamaProvider,
  setOpenRouterProvider,
} from "@/lib/ai/organisation-ai-provider";
import { GeminiProvider } from "@/lib/ai/providers/gemini-provider";
import { OllamaProvider } from "@/lib/ai/providers/ollama-provider";
import { OpenRouterProvider } from "@/lib/ai/providers/openrouter-provider";
import { prisma } from "@/lib/db/prisma";

// Every organisation used to share one operator-configured Ollama instance
// via a global env var — any business that signed up, including a
// stranger, had their agent runs sent straight to it. These tests lock in
// the property that closes that: an organisation must explicitly connect
// its own provider, one organisation's connection is never reachable from
// another's, and — since Gemini was added alongside Ollama — switching
// which provider is active never discards the other's credentials.
describe("organisation-scoped AI provider", () => {
  const organisationId = "test-org-ai-provider";
  const otherOrganisationId = "test-org-ai-provider-other";

  beforeEach(async () => {
    for (const id of [organisationId, otherOrganisationId]) {
      await prisma.integration.deleteMany({ where: { organisationId: id } });
      await prisma.organisation.deleteMany({ where: { id } });
      await prisma.organisation.create({
        data: { id, clerkOrgId: id, name: id },
      });
    }
  });

  afterAll(async () => {
    for (const id of [organisationId, otherOrganisationId]) {
      await prisma.integration.deleteMany({ where: { organisationId: id } });
      await prisma.organisation.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
  });

  it("throws AIProviderNotConfiguredError for an organisation with nothing connected", async () => {
    await expect(getAIProvider(organisationId)).rejects.toBeInstanceOf(
      AIProviderNotConfiguredError,
    );
  });

  it("returns a real OllamaProvider once connected and active by default", async () => {
    // No activeAiProvider has been set yet — this organisation predates
    // Gemini existing at all, so Ollama being the implicit default is what
    // keeps every organisation that connected before this feature shipped
    // working exactly as it did.
    await setOllamaProvider(organisationId, {
      baseUrl: "https://ollama.example.test",
      proxySecret: "shh",
    });

    const provider = await getAIProvider(organisationId);
    expect(provider).toBeInstanceOf(OllamaProvider);

    const status = await getAIProviderStatus(organisationId, null);
    expect(status.active).toBe("ollama");
    expect(status.ollama).toMatchObject({
      baseUrl: "https://ollama.example.test",
    });
    expect(status.gemini).toBeNull();
  });

  it("works without a proxy secret — only needed for the hosted auth proxy, not plain local Ollama", async () => {
    await setOllamaProvider(organisationId, {
      baseUrl: "http://localhost:11434",
    });

    await expect(getAIProvider(organisationId)).resolves.toBeInstanceOf(
      OllamaProvider,
    );
  });

  it("omitting proxySecret on a resave preserves the existing one, rather than clearing it", async () => {
    // The Settings form never echoes a real secret back into the password
    // field, so "submitted blank" must mean "leave it alone," not "clear
    // it" — otherwise every unrelated baseUrl edit would silently break
    // the proxy auth.
    await setOllamaProvider(organisationId, {
      baseUrl: "https://first.test",
      proxySecret: "original-secret",
    });
    await setOllamaProvider(organisationId, { baseUrl: "https://second.test" });

    const row = await prisma.integration.findFirstOrThrow({
      where: { organisationId, provider: "ollama" },
    });
    const { decryptToken } = await import("@/lib/crypto/token-cipher");
    const stored = JSON.parse(decryptToken(row.credentials!)) as {
      baseUrl: string;
      proxySecret: string | null;
    };
    expect(stored).toEqual({
      baseUrl: "https://second.test",
      proxySecret: "original-secret",
    });
  });

  it("passing an explicit empty string clears the proxy secret", async () => {
    await setOllamaProvider(organisationId, {
      baseUrl: "https://x.test",
      proxySecret: "to-be-cleared",
    });
    await setOllamaProvider(organisationId, {
      baseUrl: "https://x.test",
      proxySecret: "",
    });

    const row = await prisma.integration.findFirstOrThrow({
      where: { organisationId, provider: "ollama" },
    });
    const { decryptToken } = await import("@/lib/crypto/token-cipher");
    const stored = JSON.parse(decryptToken(row.credentials!)) as {
      proxySecret: string | null;
    };
    expect(stored.proxySecret).toBeNull();
  });

  it("reconnecting updates the same connection rather than creating a second one", async () => {
    await setOllamaProvider(organisationId, { baseUrl: "https://first.test" });
    await setOllamaProvider(organisationId, { baseUrl: "https://second.test" });

    const rows = await prisma.integration.findMany({
      where: { organisationId, provider: "ollama" },
    });
    expect(rows).toHaveLength(1);

    const status = await getAIProviderStatus(organisationId, null);
    expect(status.ollama).toMatchObject({ baseUrl: "https://second.test" });
  });

  it("never resolves another organisation's connection", async () => {
    await setOllamaProvider(organisationId, {
      baseUrl: "https://mine.example.test",
    });

    await expect(getAIProvider(otherOrganisationId)).rejects.toBeInstanceOf(
      AIProviderNotConfiguredError,
    );
    const otherStatus = await getAIProviderStatus(otherOrganisationId, null);
    expect(otherStatus.ollama).toBeNull();
  });

  it("credentials are encrypted at rest, not stored as plaintext", async () => {
    await setOllamaProvider(organisationId, {
      baseUrl: "https://ollama.example.test",
      proxySecret: "a-real-secret-value",
    });

    const row = await prisma.integration.findFirstOrThrow({
      where: { organisationId, provider: "ollama" },
    });
    expect(row.credentials).not.toBeNull();
    expect(row.credentials).not.toContain("a-real-secret-value");
  });

  it("disconnecting removes the connection cleanly", async () => {
    await setOllamaProvider(organisationId, { baseUrl: "https://x.test" });
    await disconnectProvider(organisationId, "ollama");

    await expect(getAIProvider(organisationId)).rejects.toBeInstanceOf(
      AIProviderNotConfiguredError,
    );
    const status = await getAIProviderStatus(organisationId, null);
    expect(status.ollama).toBeNull();
  });

  it("disconnecting an organisation with nothing connected is a harmless no-op", async () => {
    await expect(
      disconnectProvider(organisationId, "ollama"),
    ).resolves.toBeUndefined();
  });

  describe("Gemini", () => {
    it("returns a real GeminiProvider once connected and made active", async () => {
      await setGeminiProvider(organisationId, { apiKey: "real-key" });
      await setActiveProvider(organisationId, "gemini");

      const organisation = await prisma.organisation.findUniqueOrThrow({
        where: { id: organisationId },
      });
      expect(organisation.activeAiProvider).toBe("gemini");

      // getAIProvider reads the persisted activeAiProvider itself, not a
      // value threaded through by the caller — refetch to prove that,
      // rather than trusting setActiveProvider's own side effect blindly.
      const provider = await getAIProvider(organisationId);
      expect(provider).toBeInstanceOf(GeminiProvider);
    });

    it("refuses to activate a provider with nothing connected", async () => {
      await expect(setActiveProvider(organisationId, "gemini")).rejects.toThrow(
        /connect gemini first/i,
      );
    });

    it("connecting Gemini requires a real key, not an empty one", async () => {
      await expect(
        setGeminiProvider(organisationId, { apiKey: "" }),
      ).rejects.toThrow(/api key is required/i);
    });

    it("omitting apiKey on a resave preserves the existing one", async () => {
      await setGeminiProvider(organisationId, { apiKey: "original-key" });
      await setGeminiProvider(organisationId, {});

      const row = await prisma.integration.findFirstOrThrow({
        where: { organisationId, provider: "gemini" },
      });
      const { decryptToken } = await import("@/lib/crypto/token-cipher");
      const stored = JSON.parse(decryptToken(row.credentials!)) as {
        apiKey: string;
      };
      expect(stored.apiKey).toBe("original-key");
    });

    it("connecting Gemini does not disconnect or discard Ollama's credentials", async () => {
      // The entire point of storing both independently: an organisation
      // toggling to Gemini because its Ollama host is temporarily down
      // must not have to re-enter the base URL when it comes back.
      await setOllamaProvider(organisationId, {
        baseUrl: "https://ollama.example.test",
        proxySecret: "shh",
      });
      await setGeminiProvider(organisationId, { apiKey: "real-key" });
      await setActiveProvider(organisationId, "gemini");

      const status = await getAIProviderStatus(organisationId, "gemini");
      expect(status.active).toBe("gemini");
      // Ollama's connection is still there, just not active.
      expect(status.ollama).toMatchObject({
        baseUrl: "https://ollama.example.test",
      });
      expect(status.gemini).not.toBeNull();
    });

    it("switching back to Ollama after Gemini works without reconnecting", async () => {
      await setOllamaProvider(organisationId, {
        baseUrl: "https://ollama.example.test",
      });
      await setGeminiProvider(organisationId, { apiKey: "real-key" });
      await setActiveProvider(organisationId, "gemini");
      await setActiveProvider(organisationId, "ollama");

      const provider = await getAIProvider(organisationId);
      expect(provider).toBeInstanceOf(OllamaProvider);
    });

    it("disconnecting Gemini clears only Gemini's connection", async () => {
      await setOllamaProvider(organisationId, {
        baseUrl: "https://ollama.example.test",
      });
      await setGeminiProvider(organisationId, { apiKey: "real-key" });

      await disconnectProvider(organisationId, "gemini");

      const status = await getAIProviderStatus(organisationId, null);
      expect(status.gemini).toBeNull();
      expect(status.ollama).not.toBeNull();
    });
  });

  describe("OpenRouter", () => {
    it("returns a real OpenRouterProvider once connected and made active", async () => {
      await setOpenRouterProvider(organisationId, { apiKey: "real-key" });
      await setActiveProvider(organisationId, "openrouter");

      const organisation = await prisma.organisation.findUniqueOrThrow({
        where: { id: organisationId },
      });
      expect(organisation.activeAiProvider).toBe("openrouter");

      const provider = await getAIProvider(organisationId);
      expect(provider).toBeInstanceOf(OpenRouterProvider);
    });

    it("refuses to activate a provider with nothing connected", async () => {
      await expect(
        setActiveProvider(organisationId, "openrouter"),
      ).rejects.toThrow(/connect openrouter first/i);
    });

    it("connecting OpenRouter requires a real key, not an empty one", async () => {
      await expect(
        setOpenRouterProvider(organisationId, { apiKey: "" }),
      ).rejects.toThrow(/api key is required/i);
    });

    it("omitting apiKey on a resave preserves the existing one", async () => {
      await setOpenRouterProvider(organisationId, { apiKey: "original-key" });
      await setOpenRouterProvider(organisationId, {});

      const row = await prisma.integration.findFirstOrThrow({
        where: { organisationId, provider: "openrouter" },
      });
      const { decryptToken } = await import("@/lib/crypto/token-cipher");
      const stored = JSON.parse(decryptToken(row.credentials!)) as {
        apiKey: string;
      };
      expect(stored.apiKey).toBe("original-key");
    });

    it("all three providers stay independently connected regardless of which is active", async () => {
      // The whole reason each provider stores its own credentials rather
      // than one being replaced by the next: switching around (Ollama's
      // host down, try Gemini, Gemini's rate-limited, try OpenRouter, host
      // comes back) must never mean re-entering something already entered.
      await setOllamaProvider(organisationId, {
        baseUrl: "https://ollama.example.test",
      });
      await setGeminiProvider(organisationId, { apiKey: "gemini-key" });
      await setOpenRouterProvider(organisationId, { apiKey: "or-key" });

      for (const provider of ["gemini", "openrouter", "ollama"] as const) {
        await setActiveProvider(organisationId, provider);
        const status = await getAIProviderStatus(organisationId, provider);
        expect(status.active).toBe(provider);
        expect(status.ollama).not.toBeNull();
        expect(status.gemini).not.toBeNull();
        expect(status.openrouter).not.toBeNull();
      }
    });

    it("disconnecting OpenRouter clears only OpenRouter's connection", async () => {
      await setOllamaProvider(organisationId, {
        baseUrl: "https://ollama.example.test",
      });
      await setOpenRouterProvider(organisationId, { apiKey: "real-key" });

      await disconnectProvider(organisationId, "openrouter");

      const status = await getAIProviderStatus(organisationId, null);
      expect(status.openrouter).toBeNull();
      expect(status.ollama).not.toBeNull();
    });
  });
});
