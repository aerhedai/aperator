import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import * as integrationService from "@/lib/integrations/integration-service";

describe("api integration service", () => {
  const organisationId = "test-org-api-integration-service";

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "API Integration Service Test Org",
      },
    });
  });

  afterAll(async () => {
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.integration.deleteMany({ where: { organisationId } });
  });

  it("connects, normalizing the base URL to end with a trailing slash", async () => {
    const integration = await integrationService.connectApiConnection(
      organisationId,
      {
        label: "Meta Graph API",
        baseUrl: "https://graph.facebook.com/v19.0",
        token: "a-token",
      },
    );

    expect(integration.provider).toBe("api");
    const config = integration.config as { baseUrl: string };
    expect(config.baseUrl).toBe("https://graph.facebook.com/v19.0/");
  });

  it("refuses a non-absolute or non-http(s) base URL, saving nothing", async () => {
    await expect(
      integrationService.connectApiConnection(organisationId, {
        label: "Bad URL",
        baseUrl: "not-a-url",
        token: "a-token",
      }),
    ).rejects.toThrow(/valid absolute URL/i);

    await expect(
      integrationService.connectApiConnection(organisationId, {
        label: "FTP",
        baseUrl: "ftp://example.test/",
        token: "a-token",
      }),
    ).rejects.toThrow(/http or https/i);

    const saved = await prisma.integration.findMany({
      where: { organisationId, provider: "api" },
    });
    expect(saved).toHaveLength(0);
  });

  it("refuses to connect a second API under a label already in use, without touching the first", async () => {
    const first = await integrationService.connectApiConnection(
      organisationId,
      {
        label: "Duplicate Label",
        baseUrl: "https://first.example.test/",
        token: "first-token",
      },
    );

    await expect(
      integrationService.connectApiConnection(organisationId, {
        label: "Duplicate Label",
        baseUrl: "https://second.example.test/",
        token: "second-token",
      }),
    ).rejects.toThrow(/already exists/i);

    const saved = await prisma.integration.findMany({
      where: { organisationId, provider: "api", name: "Duplicate Label" },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.id).toBe(first.id);
  });

  it("findApiConnection resolves the base URL and decrypted token for a real connection", async () => {
    const integration = await integrationService.connectApiConnection(
      organisationId,
      {
        label: "Meta Graph API",
        baseUrl: "https://graph.facebook.com/v19.0/",
        token: "a-secret-token",
      },
    );

    const found = await integrationService.findApiConnection(
      organisationId,
      integration.id,
    );
    expect(found).toEqual({
      label: "Meta Graph API",
      baseUrl: "https://graph.facebook.com/v19.0/",
      token: "a-secret-token",
    });
  });

  it("findApiConnection returns null for a nonexistent connection, a different organisation's connection, or a non-api integration", async () => {
    expect(
      await integrationService.findApiConnection(organisationId, "missing"),
    ).toBeNull();

    const integration = await integrationService.connectApiConnection(
      organisationId,
      {
        label: "Meta Graph API",
        baseUrl: "https://graph.facebook.com/v19.0/",
        token: "a-token",
      },
    );
    expect(
      await integrationService.findApiConnection(
        "a-different-org",
        integration.id,
      ),
    ).toBeNull();

    const webhook = await integrationService.connectWebhookAccount(
      organisationId,
      "Not an API connection",
    );
    expect(
      await integrationService.findApiConnection(
        organisationId,
        webhook.integration.id,
      ),
    ).toBeNull();
  });
});
