import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encryptToken } from "@/lib/crypto/token-cipher";
import { prisma } from "@/lib/db/prisma";
import { ensureScopeAvailable } from "@/lib/mcp/tools/shared/ensure-scope-available";

describe("ensureScopeAvailable", () => {
  const organisationId = "test-org-ensure-scope";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Ensure Scope Test Org",
      },
    });
  });

  afterEach(async () => {
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
  });

  it("returns null (proceed) when no account is connected at all — leaves that error to the token-fetching call", async () => {
    const result = await ensureScopeAvailable(
      organisationId,
      "gmail",
      undefined,
      "GMAIL_SEND_EMAIL",
    );
    expect(result).toBeNull();
  });

  it("returns null when the connected account's granted scope covers the tool", async () => {
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "gmail",
        name: "test@company.test",
        credentials: encryptToken(JSON.stringify({ accessToken: "a" })),
        config: { grantedScopes: ["https://mail.google.com/"] },
      },
    });

    const result = await ensureScopeAvailable(
      organisationId,
      "gmail",
      undefined,
      "GMAIL_SEND_EMAIL",
    );
    expect(result).toBeNull();
  });

  it("returns a clear denial when the connected account's granted scope doesn't cover the tool", async () => {
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "outlook",
        name: "test@company.test",
        credentials: encryptToken(JSON.stringify({ accessToken: "a" })),
        // Only read access granted — Mail.Send was declined.
        config: {
          grantedScopes: ["https://graph.microsoft.com/Mail.Read"],
        },
      },
    });

    const result = await ensureScopeAvailable(
      organisationId,
      "outlook",
      undefined,
      "OUTLOOK_SEND_EMAIL",
    );
    expect(result).toMatch(/tool access denied/i);
  });

  it("resolves the specifically-pinned account, not just the organisation default", async () => {
    // A narrowly-scoped default account exists, but the pinned one has
    // full access — the pin must win.
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "outlook",
        name: "default@company.test",
        credentials: encryptToken(JSON.stringify({ accessToken: "a" })),
        config: {
          grantedScopes: ["https://graph.microsoft.com/Mail.Read"],
        },
      },
    });
    const pinned = await prisma.integration.create({
      data: {
        organisationId,
        provider: "outlook",
        name: "pinned@company.test",
        credentials: encryptToken(JSON.stringify({ accessToken: "a" })),
        config: {
          grantedScopes: ["https://graph.microsoft.com/Mail.Send"],
        },
      },
    });

    const result = await ensureScopeAvailable(
      organisationId,
      "outlook",
      pinned.id,
      "OUTLOOK_SEND_EMAIL",
    );
    expect(result).toBeNull();
  });
});
