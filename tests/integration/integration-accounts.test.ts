import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { prisma } from "@/lib/db/prisma";
import * as integrationService from "@/lib/integrations/integration-service";

describe("multi-account integrations", () => {
  const organisationId = "test-org-integration-accounts";

  beforeEach(async () => {
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.customEntityRecord.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.customEntityType.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Integration Accounts Test Org",
      },
    });
  });

  afterAll(async () => {
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.customEntityRecord.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.customEntityType.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("connecting two different Gmail addresses creates two separate accounts", async () => {
    await integrationService.connectGmailAccount(
      organisationId,
      "sales@acme.test",
      {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );
    await integrationService.connectGmailAccount(
      organisationId,
      "support@acme.test",
      {
        accessToken: "access-2",
        refreshToken: "refresh-2",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );

    const accounts = await integrationService.listIntegrationsByProvider(
      organisationId,
      "gmail",
    );
    expect(accounts.map((a) => a.name).sort()).toEqual([
      "sales@acme.test",
      "support@acme.test",
    ]);
  });

  it("reconnecting the same address updates that account rather than duplicating it", async () => {
    await integrationService.connectGmailAccount(
      organisationId,
      "sales@acme.test",
      {
        accessToken: "access-old",
        refreshToken: "refresh-old",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );
    await integrationService.connectGmailAccount(
      organisationId,
      "sales@acme.test",
      {
        accessToken: "access-new",
        refreshToken: "refresh-new",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );

    const accounts = await integrationService.listIntegrationsByProvider(
      organisationId,
      "gmail",
    );
    expect(accounts).toHaveLength(1);

    const token =
      await integrationService.getValidGmailAccessToken(organisationId);
    expect(token).toBe("access-new");
  });

  it("getValidGmailAccessToken uses the earliest-connected account as the default", async () => {
    await integrationService.connectGmailAccount(
      organisationId,
      "first@acme.test",
      {
        accessToken: "access-first",
        refreshToken: "refresh-first",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );
    await integrationService.connectGmailAccount(
      organisationId,
      "second@acme.test",
      {
        accessToken: "access-second",
        refreshToken: "refresh-second",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );

    const token =
      await integrationService.getValidGmailAccessToken(organisationId);
    expect(token).toBe("access-first");
  });

  it("disconnecting one account leaves the others untouched", async () => {
    const first = await integrationService.connectGmailAccount(
      organisationId,
      "keep@acme.test",
      {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );
    await integrationService.connectGmailAccount(
      organisationId,
      "remove@acme.test",
      {
        accessToken: "a2",
        refreshToken: "r2",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );

    const toRemove = (
      await integrationService.listIntegrationsByProvider(
        organisationId,
        "gmail",
      )
    ).find((a) => a.name === "remove@acme.test")!;
    await integrationService.disconnectIntegration(organisationId, toRemove.id);

    const remaining = await integrationService.listIntegrationsByProvider(
      organisationId,
      "gmail",
    );
    expect(remaining.map((a) => a.id)).toEqual([first.id]);
  });

  it("credentials round-trip through encryption correctly — never stored as plaintext", async () => {
    await integrationService.connectGmailAccount(
      organisationId,
      "secret@acme.test",
      {
        accessToken: "super-secret-access-token",
        refreshToken: "super-secret-refresh-token",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );

    const raw = await prisma.integration.findFirstOrThrow({
      where: { organisationId, provider: "gmail" },
    });
    expect(raw.credentials).not.toContain("super-secret-access-token");
    expect(raw.credentials).toMatch(/^v1:/);

    const token =
      await integrationService.getValidGmailAccessToken(organisationId);
    expect(token).toBe("super-secret-access-token");
  });

  it("throws a clear error when no Gmail account is connected", async () => {
    await expect(
      integrationService.getValidGmailAccessToken(organisationId),
    ).rejects.toThrow(/gmail is not connected/i);
  });

  it("getValidGmailAccessToken can be pinned to a specific account, not just the default", async () => {
    await integrationService.connectGmailAccount(
      organisationId,
      "first@acme.test",
      {
        accessToken: "access-first",
        refreshToken: "refresh-first",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );
    const second = await integrationService.connectGmailAccount(
      organisationId,
      "second@acme.test",
      {
        accessToken: "access-second",
        refreshToken: "refresh-second",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );

    // The default (no id given) is still the earliest-connected account —
    // pinning to the second account's id must override that, proving an
    // agent's actionIntegrationId actually changes which credentials get
    // used rather than being silently ignored.
    const defaultToken =
      await integrationService.getValidGmailAccessToken(organisationId);
    const pinnedToken = await integrationService.getValidGmailAccessToken(
      organisationId,
      second.id,
    );
    expect(defaultToken).toBe("access-first");
    expect(pinnedToken).toBe("access-second");
  });

  it("getValidGmailAccessToken rejects a pinned id that isn't a Gmail account", async () => {
    const { integration: webhookAccount } =
      await integrationService.connectWebhookAccount(
        organisationId,
        "Not Gmail",
      );

    await expect(
      integrationService.getValidGmailAccessToken(
        organisationId,
        webhookAccount.id,
      ),
    ).rejects.toThrow(/not a gmail account/i);
  });

  function connectSlackWorkspace(teamId: string, teamName: string) {
    return integrationService.connectOAuthAccount(organisationId, "slack", {
      accountName: teamName,
      config: { teamId, teamName },
      credentials: { botToken: `xoxb-${teamId}`, botUserId: `U-${teamId}` },
      expiresAt: null,
    });
  }

  it("connecting two different Slack workspaces creates two separate accounts", async () => {
    await connectSlackWorkspace("T1", "First Workspace");
    await connectSlackWorkspace("T2", "Second Workspace");

    const accounts = await integrationService.listIntegrationsByProvider(
      organisationId,
      "slack",
    );
    expect(accounts.map((a) => a.name).sort()).toEqual([
      "First Workspace",
      "Second Workspace",
    ]);
  });

  it("reconnecting the same Slack workspace updates that account rather than duplicating it", async () => {
    await connectSlackWorkspace("T1", "Acme Workspace");
    await connectSlackWorkspace("T1", "Acme Workspace");

    const accounts = await integrationService.listIntegrationsByProvider(
      organisationId,
      "slack",
    );
    expect(accounts).toHaveLength(1);
  });

  it("getSlackBotToken can be pinned to a specific workspace, not just the default", async () => {
    await connectSlackWorkspace("T1", "First Workspace");
    const second = await connectSlackWorkspace("T2", "Second Workspace");

    const defaultToken =
      await integrationService.getSlackBotToken(organisationId);
    const pinnedToken = await integrationService.getSlackBotToken(
      organisationId,
      second.id,
    );
    expect(defaultToken).toBe("xoxb-T1");
    expect(pinnedToken).toBe("xoxb-T2");
  });

  it("getSlackBotToken rejects a pinned id that isn't a Slack account", async () => {
    const { integration: webhookAccount } =
      await integrationService.connectWebhookAccount(
        organisationId,
        "Not Slack",
      );

    await expect(
      integrationService.getSlackBotToken(organisationId, webhookAccount.id),
    ).rejects.toThrow(/not a slack account/i);
  });

  it("throws a clear error when no Slack workspace is connected", async () => {
    await expect(
      integrationService.getSlackBotToken(organisationId),
    ).rejects.toThrow(/slack is not connected/i);
  });

  it("Slack credentials round-trip through encryption correctly — never stored as plaintext", async () => {
    await connectSlackWorkspace("T1", "Secret Workspace");

    const raw = await prisma.integration.findFirstOrThrow({
      where: { organisationId, provider: "slack" },
    });
    expect(raw.credentials).not.toContain("xoxb-T1");
    expect(raw.credentials).toMatch(/^v1:/);

    const token = await integrationService.getSlackBotToken(organisationId);
    expect(token).toBe("xoxb-T1");
  });

  function connectOutlookAccount(
    email: string,
    accessToken: string,
    refreshToken: string,
    expiresAt: Date = new Date(Date.now() + 3600_000),
  ) {
    return integrationService.connectOAuthAccount(organisationId, "outlook", {
      accountName: email,
      config: { email },
      credentials: { accessToken, refreshToken },
      expiresAt,
    });
  }

  it("connecting two different Outlook addresses creates two separate accounts", async () => {
    await connectOutlookAccount("sales@acme.test", "access-1", "refresh-1");
    await connectOutlookAccount("support@acme.test", "access-2", "refresh-2");

    const accounts = await integrationService.listIntegrationsByProvider(
      organisationId,
      "outlook",
    );
    expect(accounts.map((a) => a.name).sort()).toEqual([
      "sales@acme.test",
      "support@acme.test",
    ]);
  });

  it("reconnecting the same Outlook address updates that account rather than duplicating it", async () => {
    await connectOutlookAccount("sales@acme.test", "access-old", "refresh-old");
    await connectOutlookAccount("sales@acme.test", "access-new", "refresh-new");

    const accounts = await integrationService.listIntegrationsByProvider(
      organisationId,
      "outlook",
    );
    expect(accounts).toHaveLength(1);

    const token =
      await integrationService.getValidOutlookAccessToken(organisationId);
    expect(token).toBe("access-new");
  });

  it("getValidOutlookAccessToken can be pinned to a specific account, not just the default", async () => {
    await connectOutlookAccount(
      "first@acme.test",
      "access-first",
      "refresh-first",
    );
    const second = await connectOutlookAccount(
      "second@acme.test",
      "access-second",
      "refresh-second",
    );

    const defaultToken =
      await integrationService.getValidOutlookAccessToken(organisationId);
    const pinnedToken = await integrationService.getValidOutlookAccessToken(
      organisationId,
      second.id,
    );
    expect(defaultToken).toBe("access-first");
    expect(pinnedToken).toBe("access-second");
  });

  it("getValidOutlookAccessToken rejects a pinned id that isn't an Outlook account", async () => {
    const { integration: webhookAccount } =
      await integrationService.connectWebhookAccount(
        organisationId,
        "Not Outlook",
      );

    await expect(
      integrationService.getValidOutlookAccessToken(
        organisationId,
        webhookAccount.id,
      ),
    ).rejects.toThrow(/not an outlook account/i);
  });

  it("throws a clear error when no Outlook account is connected", async () => {
    await expect(
      integrationService.getValidOutlookAccessToken(organisationId),
    ).rejects.toThrow(/outlook is not connected/i);
  });

  it("Outlook credentials round-trip through encryption correctly — never stored as plaintext", async () => {
    await connectOutlookAccount(
      "secret@acme.test",
      "super-secret-access-token",
      "super-secret-refresh-token",
    );

    const raw = await prisma.integration.findFirstOrThrow({
      where: { organisationId, provider: "outlook" },
    });
    expect(raw.credentials).not.toContain("super-secret-access-token");
    expect(raw.credentials).toMatch(/^v1:/);

    const token =
      await integrationService.getValidOutlookAccessToken(organisationId);
    expect(token).toBe("super-secret-access-token");
  });

  describe("refresh-token rotation (Outlook, via the shared refresh helper)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("persists a rotated refresh token, not just the new access token — a dropped rotation would eventually invalidate the old one", async () => {
      const integration = await connectOutlookAccount(
        "rotate@acme.test",
        "access-1",
        "refresh-1",
        new Date(Date.now() - 1000), // already expired — forces a refresh
      );

      const firstFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "access-2",
              refresh_token: "refresh-2-rotated",
              expires_in: 3600,
            }),
            { status: 200 },
          ),
      );
      vi.stubGlobal("fetch", firstFetch);

      const token1 =
        await integrationService.getValidOutlookAccessToken(organisationId);
      expect(token1).toBe("access-2");

      const [, firstInit] = firstFetch.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      const firstBody = new URLSearchParams(firstInit.body as string);
      expect(firstBody.get("refresh_token")).toBe("refresh-1");

      // Force another refresh, and confirm it uses the *rotated* token
      // (refresh-2-rotated), not the original (refresh-1) — proving the
      // rotation was actually persisted by getValidAccessToken, not
      // silently dropped.
      await prisma.integration.update({
        where: { id: integration.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const secondFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ access_token: "access-3", expires_in: 3600 }),
            { status: 200 },
          ),
      );
      vi.stubGlobal("fetch", secondFetch);

      const token2 =
        await integrationService.getValidOutlookAccessToken(organisationId);
      expect(token2).toBe("access-3");

      const [, secondInit] = secondFetch.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      const secondBody = new URLSearchParams(secondInit.body as string);
      expect(secondBody.get("refresh_token")).toBe("refresh-2-rotated");
    });
  });

  function connectTeamsAccount(email: string) {
    return integrationService.connectOAuthAccount(organisationId, "teams", {
      accountName: email,
      config: { email },
      credentials: {
        accessToken: `access-${email}`,
        refreshToken: `refresh-${email}`,
      },
      expiresAt: new Date(Date.now() + 3600_000),
    });
  }

  it("getValidTeamsAccessToken defaults to the earliest-connected account and can be pinned", async () => {
    await connectTeamsAccount("first@acme.test");
    const second = await connectTeamsAccount("second@acme.test");

    const defaultToken =
      await integrationService.getValidTeamsAccessToken(organisationId);
    const pinnedToken = await integrationService.getValidTeamsAccessToken(
      organisationId,
      second.id,
    );
    expect(defaultToken).toBe("access-first@acme.test");
    expect(pinnedToken).toBe("access-second@acme.test");
  });

  it("getValidTeamsAccessToken rejects a pinned id from the wrong provider", async () => {
    const { integration: webhookAccount } =
      await integrationService.connectWebhookAccount(
        organisationId,
        "Not Teams",
      );

    await expect(
      integrationService.getValidTeamsAccessToken(
        organisationId,
        webhookAccount.id,
      ),
    ).rejects.toThrow(/not a teams account/i);
  });

  function connectCalendarAccount(email: string) {
    return integrationService.connectOAuthAccount(
      organisationId,
      "outlook-calendar",
      {
        accountName: email,
        config: { email },
        credentials: {
          accessToken: `access-${email}`,
          refreshToken: `refresh-${email}`,
        },
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );
  }

  it("getValidOutlookCalendarAccessToken defaults to the earliest-connected account and can be pinned", async () => {
    await connectCalendarAccount("first@acme.test");
    const second = await connectCalendarAccount("second@acme.test");

    const defaultToken =
      await integrationService.getValidOutlookCalendarAccessToken(
        organisationId,
      );
    const pinnedToken =
      await integrationService.getValidOutlookCalendarAccessToken(
        organisationId,
        second.id,
      );
    expect(defaultToken).toBe("access-first@acme.test");
    expect(pinnedToken).toBe("access-second@acme.test");
  });

  it("getValidOutlookCalendarAccessToken rejects a pinned id from the wrong provider", async () => {
    const { integration: webhookAccount } =
      await integrationService.connectWebhookAccount(
        organisationId,
        "Not Calendar",
      );

    await expect(
      integrationService.getValidOutlookCalendarAccessToken(
        organisationId,
        webhookAccount.id,
      ),
    ).rejects.toThrow(/not an outlook calendar account/i);
  });

  function connectGoogleDriveAccount(email: string) {
    return integrationService.connectOAuthAccount(
      organisationId,
      "google-drive",
      {
        accountName: email,
        config: { email },
        credentials: {
          accessToken: `access-${email}`,
          refreshToken: `refresh-${email}`,
        },
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );
  }

  it("connecting two different Google Drive accounts creates two separate accounts", async () => {
    await connectGoogleDriveAccount("sales@acme.test");
    await connectGoogleDriveAccount("support@acme.test");

    const accounts = await integrationService.listIntegrationsByProvider(
      organisationId,
      "google-drive",
    );
    expect(accounts.map((a) => a.name).sort()).toEqual([
      "sales@acme.test",
      "support@acme.test",
    ]);
  });

  it("reconnecting the same Google Drive account updates it rather than duplicating it", async () => {
    const first = await connectGoogleDriveAccount("ops@acme.test");
    const second = await connectGoogleDriveAccount("ops@acme.test");

    expect(second.id).toBe(first.id);
    const accounts = await integrationService.listIntegrationsByProvider(
      organisationId,
      "google-drive",
    );
    expect(accounts).toHaveLength(1);
  });

  it("getValidGoogleDriveAccessToken defaults to the earliest-connected account and can be pinned", async () => {
    await connectGoogleDriveAccount("first@acme.test");
    const second = await connectGoogleDriveAccount("second@acme.test");

    const defaultToken =
      await integrationService.getValidGoogleDriveAccessToken(organisationId);
    const pinnedToken = await integrationService.getValidGoogleDriveAccessToken(
      organisationId,
      second.id,
    );
    expect(defaultToken).toBe("access-first@acme.test");
    expect(pinnedToken).toBe("access-second@acme.test");
  });

  it("getValidGoogleDriveAccessToken rejects a pinned id from the wrong provider", async () => {
    const { integration: webhookAccount } =
      await integrationService.connectWebhookAccount(
        organisationId,
        "Not Drive",
      );

    await expect(
      integrationService.getValidGoogleDriveAccessToken(
        organisationId,
        webhookAccount.id,
      ),
    ).rejects.toThrow(/not a google drive account/i);
  });

  it("throws a clear error when no Google Drive account is connected", async () => {
    await expect(
      integrationService.getValidGoogleDriveAccessToken(organisationId),
    ).rejects.toThrow(/google drive is not connected/i);
  });

  function connectSharePointAccount(email: string) {
    return integrationService.connectOAuthAccount(
      organisationId,
      "sharepoint",
      {
        accountName: email,
        config: { email },
        credentials: {
          accessToken: `access-${email}`,
          refreshToken: `refresh-${email}`,
        },
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );
  }

  it("connecting two different SharePoint accounts creates two separate accounts", async () => {
    await connectSharePointAccount("sales@acme.test");
    await connectSharePointAccount("support@acme.test");

    const accounts = await integrationService.listIntegrationsByProvider(
      organisationId,
      "sharepoint",
    );
    expect(accounts.map((a) => a.name).sort()).toEqual([
      "sales@acme.test",
      "support@acme.test",
    ]);
  });

  it("reconnecting the same SharePoint account updates it rather than duplicating it", async () => {
    const first = await connectSharePointAccount("ops@acme.test");
    const second = await connectSharePointAccount("ops@acme.test");

    expect(second.id).toBe(first.id);
    const accounts = await integrationService.listIntegrationsByProvider(
      organisationId,
      "sharepoint",
    );
    expect(accounts).toHaveLength(1);
  });

  it("getValidSharePointAccessToken defaults to the earliest-connected account and can be pinned", async () => {
    await connectSharePointAccount("first@acme.test");
    const second = await connectSharePointAccount("second@acme.test");

    const defaultToken =
      await integrationService.getValidSharePointAccessToken(organisationId);
    const pinnedToken = await integrationService.getValidSharePointAccessToken(
      organisationId,
      second.id,
    );
    expect(defaultToken).toBe("access-first@acme.test");
    expect(pinnedToken).toBe("access-second@acme.test");
  });

  it("getValidSharePointAccessToken rejects a pinned id from the wrong provider", async () => {
    const { integration: webhookAccount } =
      await integrationService.connectWebhookAccount(
        organisationId,
        "Not SharePoint",
      );

    await expect(
      integrationService.getValidSharePointAccessToken(
        organisationId,
        webhookAccount.id,
      ),
    ).rejects.toThrow(/not a sharepoint account/i);
  });

  it("throws a clear error when no SharePoint account is connected", async () => {
    await expect(
      integrationService.getValidSharePointAccessToken(organisationId),
    ).rejects.toThrow(/sharepoint is not connected/i);
  });

  it("Google Drive and SharePoint credentials round-trip through encryption correctly — never stored as plaintext", async () => {
    await connectGoogleDriveAccount("crypto-drive@acme.test");
    await connectSharePointAccount("crypto-sharepoint@acme.test");

    const rawDrive = await prisma.integration.findFirstOrThrow({
      where: { organisationId, provider: "google-drive" },
    });
    const rawSharePoint = await prisma.integration.findFirstOrThrow({
      where: { organisationId, provider: "sharepoint" },
    });
    expect(rawDrive.credentials).not.toContain("access-crypto-drive@acme.test");
    expect(rawDrive.credentials).toMatch(/^v1:/);
    expect(rawSharePoint.credentials).not.toContain(
      "access-crypto-sharepoint@acme.test",
    );
    expect(rawSharePoint.credentials).toMatch(/^v1:/);

    expect(
      await integrationService.getValidGoogleDriveAccessToken(organisationId),
    ).toBe("access-crypto-drive@acme.test");
    expect(
      await integrationService.getValidSharePointAccessToken(organisationId),
    ).toBe("access-crypto-sharepoint@acme.test");
  });

  describe("email-agnostic resolvers (Gmail + Outlook Mail)", () => {
    it("getDefaultEmailIntegration picks the earliest-connected across both providers, not Gmail-biased", async () => {
      // Outlook connected first, Gmail second — the Outlook account must
      // still win, proving there's no hardcoded "Gmail always wins"
      // priority.
      const outlook = await connectOutlookAccount(
        "outlook@acme.test",
        "access-outlook",
        "refresh-outlook",
      );
      await integrationService.connectGmailAccount(
        organisationId,
        "gmail@acme.test",
        {
          accessToken: "access-gmail",
          refreshToken: "refresh-gmail",
          expiresAt: new Date(Date.now() + 3600_000),
        },
      );

      const result =
        await integrationService.getDefaultEmailIntegration(organisationId);
      expect(result?.id).toBe(outlook.id);
    });

    it("resolveEmailProvider resolves to whichever email provider is actually connected", async () => {
      await connectOutlookAccount(
        "only-outlook@acme.test",
        "access-outlook-only",
        "refresh-outlook-only",
      );

      const result =
        await integrationService.resolveEmailProvider(organisationId);
      expect(result).toBe("outlook");
    });

    it("resolveEmailProvider throws a clear error when neither Gmail nor Outlook is connected", async () => {
      await expect(
        integrationService.resolveEmailProvider(organisationId),
      ).rejects.toThrow(/no email account.*is connected/i);
    });

    it("getConnectedEmailIntegrations returns one entry per connected email provider, not every account", async () => {
      const none =
        await integrationService.getConnectedEmailIntegrations(organisationId);
      expect(none).toHaveLength(0);

      await integrationService.connectGmailAccount(
        organisationId,
        "gmail@acme.test",
        {
          accessToken: "a",
          refreshToken: "r",
          expiresAt: new Date(Date.now() + 3600_000),
        },
      );
      const oneConnected =
        await integrationService.getConnectedEmailIntegrations(organisationId);
      expect(oneConnected.map((i) => i.provider)).toEqual(["gmail"]);

      await connectOutlookAccount(
        "outlook@acme.test",
        "access-outlook",
        "refresh-outlook",
      );
      const bothConnected =
        await integrationService.getConnectedEmailIntegrations(organisationId);
      expect(bothConnected.map((i) => i.provider).sort()).toEqual([
        "gmail",
        "outlook",
      ]);
    });
  });
});
