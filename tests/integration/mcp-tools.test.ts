import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import PizZip from "pizzip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db/prisma";
import * as integrationService from "@/lib/integrations/integration-service";
import { createMcpServer } from "@/lib/mcp/server";
import { createRecord } from "@/tests/helpers/records";

// Real MCP protocol round trip (list + call, real Zod validation, real
// handlers) over an in-memory transport pair — no network, deterministic,
// CI-safe, but not a mock: this is the actual client/server/protocol code.
// The four lookup tools are now DB-backed per organisation (no more shared
// lib/mcp/mock-data.ts), so each test run gets its own fixture rows.
describe("MCP tool server", () => {
  let client: Client;
  const organisationId = "test-org-mcp-tools";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "MCP Tools Test Org",
        currency: "GBP",
      },
    });
    await createRecord(organisationId, "Product", {
      sku: "WIDGET-A",
      name: "Product A",
      unitPrice: 15,
      stockQuantity: 700,
    });
    await createRecord(organisationId, "Customer", {
      name: "Customer ABC",
      email: "buyer@customer-abc.test",
      company: "Customer ABC Ltd",
    });
    const propertyType = await prisma.customEntityType.create({
      data: {
        organisationId,
        name: "Property",
        fields: [
          { name: "address", description: "the property address" },
          { name: "tenant", description: "the current tenant's name" },
        ],
      },
    });
    await prisma.customEntityRecord.create({
      data: {
        organisationId,
        entityTypeId: propertyType.id,
        data: { address: "14 Birch Road", tenant: "Jordan Reyes" },
      },
    });

    const server = await createMcpServer(organisationId);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await client.close();
    await prisma.customEntityRecord.deleteMany({ where: { organisationId } });
    await prisma.customEntityType.deleteMany({ where: { organisationId } });
    await prisma.integration.deleteMany({ where: { organisationId } });
    // Only this organisation's own agents — built-in AgentTemplate rows
    // (organisationId: null) are a shared, global fixture other tests
    // also rely on and must never be touched here.
    await prisma.agentTool.deleteMany({ where: { agent: { organisationId } } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
  });

  it("lists exactly the twenty-seven registered tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    // Asserted as an exact list, not a count: the registry is meant to stay
    // small and fixed, and a tool appearing here that nobody deliberately
    // added is the failure this catches (CLAUDE.md §4.5).
    expect(names).toEqual([
      "GMAIL_READ_INBOX",
      "GMAIL_SEND_EMAIL",
      "GOOGLE_DRIVE_CREATE_FOLDER",
      "GOOGLE_DRIVE_POPULATE_TEMPLATE",
      "GOOGLE_DRIVE_SAVE_FILE",
      "OUTLOOK_CHECK_CALENDAR_AVAILABILITY",
      "OUTLOOK_CREATE_CALENDAR_EVENT",
      "OUTLOOK_READ_INBOX",
      "OUTLOOK_SEND_EMAIL",
      "SHAREPOINT_CREATE_FOLDER",
      "SHAREPOINT_POPULATE_TEMPLATE",
      "SHAREPOINT_SAVE_FILE",
      "SLACK_POST_MESSAGE",
      "TEAMS_POST_MESSAGE",
      "create_record",
      "create_routine",
      "create_task",
      "find_record",
      "install_template",
      "install_workflow_template",
      "invoke_agent",
      "invoke_workflow",
      "list_invokable",
      "list_templates",
      "search_knowledge",
      "search_records",
      "update_record",
    ]);
  });

  it("list_templates returns the seeded built-in templates", async () => {
    const result = await client.callTool({
      name: "list_templates",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const templates = (
      result.structuredContent as { templates: { name: string }[] }
    ).templates;
    expect(templates.map((t) => t.name)).toContain("Look up and quote");
  });

  it("install_template creates a real, draft agent with the template's own tools", async () => {
    const listed = await client.callTool({
      name: "list_templates",
      arguments: {},
    });
    const templates = (
      listed.structuredContent as {
        templates: { id: string; name: string; suggestedTools: string[] }[];
      }
    ).templates;
    const quoteTemplate = templates.find((t) => t.name === "Look up and quote");
    if (!quoteTemplate) throw new Error("fixture template not found");

    const result = await client.callTool({
      name: "install_template",
      arguments: { templateId: quoteTemplate.id },
    });

    expect(result.isError).toBeFalsy();
    const { agentId, agentName } = result.structuredContent as {
      agentId: string;
      agentName: string;
    };
    expect(agentName).toBe("Look up and quote");

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { tools: true },
    });
    expect(agent).toMatchObject({
      organisationId,
      status: "DRAFT",
      executionMode: "HARNESS",
      pipelineKey: "steps",
      // The whole point of pairing this with the default-allow invocation
      // model — installed by chat or by a human, it's callable immediately.
      chatInvokable: true,
    });
    expect(agent?.tools.map((t) => t.toolName).sort()).toEqual(
      [...quoteTemplate.suggestedTools].sort(),
    );
  });

  it("install_template fails clearly for an unknown template id, creating nothing", async () => {
    const before = await prisma.agent.count({ where: { organisationId } });

    const result = await client.callTool({
      name: "install_template",
      arguments: { templateId: "not-a-real-template-id" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("not found") },
    ]);

    const after = await prisma.agent.count({ where: { organisationId } });
    expect(after).toBe(before);
  });

  it("find_record reaches the built-in Customer type by an exact field match", async () => {
    const result = await client.callTool({
      name: "find_record",
      arguments: {
        recordType: "Customer",
        field: "email",
        value: "buyer@customer-abc.test",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      found: true,
      record: { type: "Customer", data: { name: "Customer ABC" } },
    });
  });

  it("find_record reports not found for a value that matches nothing", async () => {
    const result = await client.callTool({
      name: "find_record",
      arguments: {
        recordType: "Customer",
        field: "email",
        value: "nobody@nowhere.test",
      },
    });

    expect(result.structuredContent).toEqual({ found: false, record: null });
  });

  it("find_record reaches the built-in Product type, exposing stock as an ordinary field", async () => {
    // check_inventory used to be its own tool. Availability is a property
    // of the product, not a separate capability (CLAUDE.md §4.5), so it
    // arrives here as just another field on the record.
    const result = await client.callTool({
      name: "find_record",
      arguments: { recordType: "Product", field: "sku", value: "WIDGET-A" },
    });

    expect(result.structuredContent).toMatchObject({
      found: true,
      record: {
        type: "Product",
        data: { sku: "WIDGET-A", unitPrice: 15, stockQuantity: 700 },
      },
    });
  });

  it("search_records fuzzily matches a built-in Product by name", async () => {
    const result = await client.callTool({
      name: "search_records",
      arguments: { recordType: "Product", query: "Product A" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      found: true,
      records: [{ type: "Product", data: { sku: "WIDGET-A" } }],
    });
  });

  it("names the record types that do exist when given one that doesn't", async () => {
    // An unknown type name and a genuinely empty result are different
    // failures — collapsing them would let a misconfigured agent look like
    // it is working against an empty dataset.
    const result = await client.callTool({
      name: "find_record",
      arguments: { recordType: "Sprocket", field: "id", value: "x" },
    });

    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("Sprocket");
    expect(text).toContain("Customer");
    expect(text).toContain("Product");
  });

  it("lets an agent create a Product, which the built-in table refused", async () => {
    // This exact call used to be refused: Product was a real table whose
    // unitPrice was a Decimal column, and an untyped bag from a model could
    // not safely populate it. Product is an ordinary record type now, so the
    // write goes through — and the currency field coerces the model's string
    // "12.5" into a real number rather than storing the string.
    const result = await client.callTool({
      name: "create_record",
      arguments: {
        recordType: "Product",
        data: {
          sku: "X-1",
          name: "Written by an agent",
          unitPrice: "12.5",
          stockQuantity: "3",
        },
      },
    });

    expect(result.isError).toBeFalsy();

    const created = await prisma.customEntityRecord.findFirstOrThrow({
      where: { organisationId, data: { path: ["sku"], equals: "X-1" } },
    });
    const data = created.data as Record<string, unknown>;
    // Regression test for a real hole this change exposed: create_record
    // went straight to the repository, so a model supplying "12.5" for a
    // currency field stored the *string*. Reads looked fine; arithmetic in a
    // later compute step silently didn't. Only the Catalog form coerced.
    expect(data.unitPrice).toBe(12.5);
    expect(data.stockQuantity).toBe(3);
  });

  it("rejects a value that isn't valid for its field type, naming the field", async () => {
    const result = await client.callTool({
      name: "create_record",
      arguments: {
        recordType: "Product",
        data: {
          sku: "X-2",
          name: "Not a price",
          unitPrice: "not a number",
          stockQuantity: 1,
        },
      },
    });

    expect(result.isError).toBe(true);
    // Naming the field is the point — "invalid input" gives a model nothing
    // to correct on a retry.
    expect(JSON.stringify(result.content)).toContain("unitPrice");
  });

  it("reports invalid input as a tool error before the handler runs", async () => {
    const result = await client.callTool({
      name: "find_record",
      arguments: { recordType: "Customer", field: "email", value: "" },
    });

    expect(result.isError).toBe(true);
  });

  it("GMAIL_SEND_EMAIL reports a tool error when Gmail isn't connected for the organisation", async () => {
    const result = await client.callTool({
      name: "GMAIL_SEND_EMAIL",
      arguments: {
        to: "buyer@customer-abc.test",
        subject: "Your quote",
        body: "£7,500 for 500 units of Product A.",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining("Gmail is not connected"),
      },
    ]);
  });

  it("GMAIL_SEND_EMAIL is scoped to the organisation the server was constructed for, not any org the LLM names", async () => {
    // Confirms organisationId can't be smuggled in via tool arguments (the
    // Zod input schema doesn't even accept one) — it's bound at server
    // construction, so a malicious/confused LLM has no channel to target
    // another organisation's email credentials (CLAUDE.md #22).
    const result = await client.callTool({
      name: "GMAIL_SEND_EMAIL",
      arguments: {
        to: "buyer@customer-abc.test",
        subject: "Your quote",
        body: "£7,500 for 500 units of Product A.",
        organisationId: "some-other-org",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining("Gmail is not connected"),
      },
    ]);
  });

  it("OUTLOOK_SEND_EMAIL reports a tool error when Outlook isn't connected, even if Gmail is", async () => {
    // Proves the two are genuinely independent tools now — connecting
    // Gmail must never make OUTLOOK_SEND_EMAIL silently work.
    await integrationService.connectGmailAccount(
      organisationId,
      "gmail@acme.test",
      {
        accessToken: "access-gmail",
        refreshToken: "refresh-gmail",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    );

    const result = await client.callTool({
      name: "OUTLOOK_SEND_EMAIL",
      arguments: {
        to: "buyer@customer-abc.test",
        subject: "Your quote",
        body: "£7,500 for 500 units of Product A.",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining("Outlook is not connected"),
      },
    ]);
  });

  it("OUTLOOK_SEND_EMAIL sends via Outlook once connected", async () => {
    await integrationService.connectOAuthAccount(organisationId, "outlook", {
      accountName: "sales@acme.test",
      config: { email: "sales@acme.test" },
      credentials: {
        accessToken: "access-outlook",
        refreshToken: "refresh-outlook",
      },
      expiresAt: new Date(Date.now() + 3600_000),
      grantedScopes: ["https://graph.microsoft.com/Mail.Send"],
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.callTool({
      name: "OUTLOOK_SEND_EMAIL",
      arguments: {
        to: "buyer@customer-abc.test",
        subject: "Your quote",
        body: "£7,500 for 500 units of Product A.",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ sent: true });
    const [calledUrl] = fetchMock.mock.calls[0] as unknown as [string];
    expect(calledUrl).toContain("/sendMail");
  });

  it("OUTLOOK_SEND_EMAIL is denied when the connected account has Mail.Read but not Mail.Send — the real, genuinely-partial-grant case", async () => {
    await integrationService.connectOAuthAccount(organisationId, "outlook", {
      accountName: "sales@acme.test",
      config: { email: "sales@acme.test" },
      credentials: {
        accessToken: "access-outlook",
        refreshToken: "refresh-outlook",
      },
      expiresAt: new Date(Date.now() + 3600_000),
      // Declined Mail.Send on the consent screen — a real, not synthetic,
      // partial grant (unlike every other provider here, Outlook's
      // Mail.Read/Mail.Send are independently grantable).
      grantedScopes: ["https://graph.microsoft.com/Mail.Read"],
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.callTool({
      name: "OUTLOOK_SEND_EMAIL",
      arguments: {
        to: "buyer@customer-abc.test",
        subject: "Your quote",
        body: "£7,500 for 500 units of Product A.",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      { type: "text", text: expect.stringContaining("Tool access denied") },
    ]);
    // Caught proactively, before ever attempting the real API call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("SLACK_POST_MESSAGE reports a tool error when Slack isn't connected for the organisation", async () => {
    const result = await client.callTool({
      name: "SLACK_POST_MESSAGE",
      arguments: {
        channel: "#general",
        message: "A quote needs approval.",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      { type: "text", text: expect.stringContaining("Slack is not connected") },
    ]);
  });

  it("SLACK_POST_MESSAGE is scoped to the organisation the server was constructed for, not any org the LLM names", async () => {
    const result = await client.callTool({
      name: "SLACK_POST_MESSAGE",
      arguments: {
        channel: "#general",
        message: "A quote needs approval.",
        organisationId: "some-other-org",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      { type: "text", text: expect.stringContaining("Slack is not connected") },
    ]);
  });

  it("TEAMS_POST_MESSAGE reports a tool error when Teams isn't connected for the organisation", async () => {
    const result = await client.callTool({
      name: "TEAMS_POST_MESSAGE",
      arguments: {
        teamId: "team-1",
        channel: "channel-1",
        message: "A quote needs approval.",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      { type: "text", text: expect.stringContaining("Teams is not connected") },
    ]);
  });

  it("TEAMS_POST_MESSAGE is scoped to the organisation the server was constructed for, not any org the LLM names", async () => {
    const result = await client.callTool({
      name: "TEAMS_POST_MESSAGE",
      arguments: {
        teamId: "team-1",
        channel: "channel-1",
        message: "A quote needs approval.",
        organisationId: "some-other-org",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      { type: "text", text: expect.stringContaining("Teams is not connected") },
    ]);
  });

  it("TEAMS_POST_MESSAGE rejects a missing teamId at the schema level, rather than failing obscurely later", async () => {
    // teamId is a required schema field on this tool (not a conditional
    // handler-level check the way the old shared notify_channel needed,
    // since this tool only ever means Teams) — Zod rejects it before the
    // handler ever runs.
    const result = await client.callTool({
      name: "TEAMS_POST_MESSAGE",
      arguments: {
        channel: "channel-1",
        message: "Needs attention.",
      },
    });

    expect(result.isError).toBe(true);
  });

  it("OUTLOOK_CHECK_CALENDAR_AVAILABILITY reports a tool error when Outlook Calendar isn't connected", async () => {
    const result = await client.callTool({
      name: "OUTLOOK_CHECK_CALENDAR_AVAILABILITY",
      arguments: {
        attendees: ["buyer@customer-abc.test"],
        durationMinutes: 30,
        rangeStart: "2026-09-02T09:00:00.000Z",
        rangeEnd: "2026-09-02T17:00:00.000Z",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining("Outlook Calendar is not connected"),
      },
    ]);
  });

  it("OUTLOOK_CREATE_CALENDAR_EVENT reports a tool error when Outlook Calendar isn't connected", async () => {
    const result = await client.callTool({
      name: "OUTLOOK_CREATE_CALENDAR_EVENT",
      arguments: {
        subject: "Quote review",
        start: "2026-09-02T09:00:00.000Z",
        end: "2026-09-02T09:30:00.000Z",
        attendees: ["buyer@customer-abc.test"],
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining("Outlook Calendar is not connected"),
      },
    ]);
  });

  it("OUTLOOK_CREATE_CALENDAR_EVENT is scoped to the organisation the server was constructed for, not any org the LLM names", async () => {
    const result = await client.callTool({
      name: "OUTLOOK_CREATE_CALENDAR_EVENT",
      arguments: {
        subject: "Quote review",
        start: "2026-09-02T09:00:00.000Z",
        end: "2026-09-02T09:30:00.000Z",
        attendees: ["buyer@customer-abc.test"],
        organisationId: "some-other-org",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining("Outlook Calendar is not connected"),
      },
    ]);
  });

  it("search_records finds a record by any field, not just a fixed one", async () => {
    const result = await client.callTool({
      name: "search_records",
      arguments: { recordType: "Property", query: "Birch" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      found: true,
      records: [{ data: { address: "14 Birch Road", tenant: "Jordan Reyes" } }],
    });
  });

  it("search_records matches on a field other than the first one", async () => {
    const result = await client.callTool({
      name: "search_records",
      arguments: { recordType: "Property", query: "Jordan Reyes" },
    });

    expect(result.structuredContent).toMatchObject({ found: true });
  });

  it("search_records reports not found for no match", async () => {
    const result = await client.callTool({
      name: "search_records",
      arguments: { recordType: "Property", query: "nonexistent" },
    });

    expect(result.structuredContent).toEqual({ found: false, records: [] });
  });

  it("search_records errors clearly for a record type that doesn't exist", async () => {
    const result = await client.callTool({
      name: "search_records",
      arguments: { recordType: "NotARealType", query: "anything" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining('No record type named "NotARealType"'),
      },
    ]);
  });

  it("find_record matches an exact field value, not a substring", async () => {
    const found = await client.callTool({
      name: "find_record",
      arguments: {
        recordType: "Property",
        field: "tenant",
        value: "Jordan Reyes",
      },
    });
    expect(found.structuredContent).toMatchObject({
      found: true,
      record: { data: { tenant: "Jordan Reyes" } },
    });

    const notFound = await client.callTool({
      name: "find_record",
      arguments: { recordType: "Property", field: "tenant", value: "Jordan" },
    });
    expect(notFound.structuredContent).toEqual({ found: false, record: null });
  });

  it("create_record creates a new record with the given fields", async () => {
    const result = await client.callTool({
      name: "create_record",
      arguments: {
        recordType: "Property",
        data: { address: "9 Oak Lane", tenant: "Sam Okafor" },
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      record: { data: { address: "9 Oak Lane", tenant: "Sam Okafor" } },
    });

    const refetch = await client.callTool({
      name: "find_record",
      arguments: {
        recordType: "Property",
        field: "tenant",
        value: "Sam Okafor",
      },
    });
    expect(refetch.structuredContent).toMatchObject({ found: true });
  });

  it("update_record merges fields, leaving others untouched", async () => {
    const existing = await client.callTool({
      name: "find_record",
      arguments: {
        recordType: "Property",
        field: "tenant",
        value: "Jordan Reyes",
      },
    });
    const recordId = (existing.structuredContent as { record: { id: string } })
      .record.id;

    const result = await client.callTool({
      name: "update_record",
      arguments: {
        recordType: "Property",
        recordId,
        data: { status: "Vacated" },
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      record: {
        data: {
          address: "14 Birch Road",
          tenant: "Jordan Reyes",
          status: "Vacated",
        },
      },
    });
  });

  it("update_record errors clearly for a record id that doesn't exist", async () => {
    const result = await client.callTool({
      name: "update_record",
      arguments: {
        recordType: "Property",
        recordId: "nonexistent-id",
        data: { status: "Vacated" },
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining('No record with id "nonexistent-id"'),
      },
    ]);
  });

  it("GOOGLE_DRIVE_CREATE_FOLDER reports a tool error when the storage provider isn't connected", async () => {
    const result = await client.callTool({
      name: "GOOGLE_DRIVE_CREATE_FOLDER",
      arguments: { path: ["1042"] },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining("Google Drive is not connected"),
      },
    ]);
  });

  it("SHAREPOINT_CREATE_FOLDER rejects a missing siteName at the schema level", async () => {
    // siteName is a required schema field on this tool (unconditionally,
    // since this tool only ever means SharePoint) — Zod rejects it before
    // the handler ever runs, rather than a handler-level check.
    const result = await client.callTool({
      name: "SHAREPOINT_CREATE_FOLDER",
      arguments: { path: ["1042"] },
    });

    expect(result.isError).toBe(true);
  });

  it("SHAREPOINT_CREATE_FOLDER reports a tool error when the storage provider isn't connected", async () => {
    const result = await client.callTool({
      name: "SHAREPOINT_CREATE_FOLDER",
      arguments: { siteName: "Acme Site", path: ["1042"] },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining("SharePoint is not connected"),
      },
    ]);
  });

  it("GOOGLE_DRIVE_SAVE_FILE reports a tool error when the storage provider isn't connected", async () => {
    const result = await client.callTool({
      name: "GOOGLE_DRIVE_SAVE_FILE",
      arguments: {
        path: ["1042", "Client correspondence"],
        filename: "latest.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("hello").toString("base64"),
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining("Google Drive is not connected"),
      },
    ]);
  });

  it("GOOGLE_DRIVE_POPULATE_TEMPLATE reports a tool error when the storage provider isn't connected", async () => {
    const result = await client.callTool({
      name: "GOOGLE_DRIVE_POPULATE_TEMPLATE",
      arguments: {
        templatePath: ["Templates", "quote-template.docx"],
        outputPath: ["1042", "Quotation"],
        outputFilename: "quote-final.docx",
        data: { customerName: "Customer ABC" },
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining("Google Drive is not connected"),
      },
    ]);
  });

  it("GOOGLE_DRIVE_POPULATE_TEMPLATE downloads a real template, fills its {field} placeholders, and uploads the result", async () => {
    await integrationService.connectOAuthAccount(
      organisationId,
      "google-drive",
      {
        accountName: "drive@acme.test",
        config: {},
        credentials: {
          accessToken: "drive-token",
          refreshToken: "drive-refresh",
        },
        expiresAt: new Date(Date.now() + 3600_000),
        grantedScopes: ["https://www.googleapis.com/auth/drive"],
      },
    );

    // A minimal-but-real .docx: docxtemplater only requires
    // [Content_Types].xml, _rels/.rels, and word/document.xml to render —
    // confirmed via a disposable scratch script before writing this test.
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Quote for {customerName}: {amount}</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const templateZip = new PizZip();
    templateZip.file("[Content_Types].xml", contentTypesXml);
    templateZip.file("_rels/.rels", relsXml);
    templateZip.file("word/document.xml", documentXml);
    const templateBuffer = templateZip.generate({
      type: "nodebuffer",
    }) as Buffer;

    let uploadedBody: Buffer | undefined;
    let folderCreations = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const urlStr = String(url);
      const decoded = decodeURIComponent(urlStr).replace(/\+/g, " ");

      if (decoded.includes("alt=media")) {
        return new Response(new Uint8Array(templateBuffer), { status: 200 });
      }
      if (urlStr.includes("/upload/drive/v3/files")) {
        uploadedBody = Buffer.from(init?.body as Buffer);
        return new Response(JSON.stringify({ id: "output-file-id" }), {
          status: 200,
        });
      }
      if (method === "POST") {
        folderCreations += 1;
        return new Response(
          JSON.stringify({ id: `created-folder-${folderCreations}` }),
          { status: 200 },
        );
      }
      if (decoded.includes("mimeType!=")) {
        return new Response(
          JSON.stringify({ files: [{ id: "template-file-id" }] }),
          { status: 200 },
        );
      }
      if (decoded.includes("name='Templates'")) {
        return new Response(
          JSON.stringify({ files: [{ id: "templates-folder-id" }] }),
          { status: 200 },
        );
      }
      // The output path's folders don't exist yet — ensureFolderPath must
      // create them, proving this test isn't accidentally reusing an
      // existing folder that happened to already contain the right file.
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    });

    const result = await client.callTool({
      name: "GOOGLE_DRIVE_POPULATE_TEMPLATE",
      arguments: {
        templatePath: ["Templates", "quote-template.docx"],
        outputPath: ["1042", "Quotation"],
        outputFilename: "quote-final.docx",
        data: { customerName: "Customer ABC", amount: "£7,500" },
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ fileId: "output-file-id" });
    expect(folderCreations).toBe(2); // "1042", then "Quotation" inside it
    if (!uploadedBody) {
      throw new Error("Expected the upload endpoint to have been called.");
    }
    const renderedZip = new PizZip(uploadedBody);
    const renderedXml = renderedZip.file("word/document.xml")?.asText();
    expect(renderedXml).toContain("Customer ABC");
    expect(renderedXml).toContain("£7,500");
    expect(renderedXml).not.toContain("{customerName}");
  });

  it("GMAIL_SEND_EMAIL resolves an attachment reference from connected storage and includes it in the outbound message", async () => {
    await integrationService.connectOAuthAccount(
      organisationId,
      "google-drive",
      {
        accountName: "drive@acme.test",
        config: {},
        credentials: {
          accessToken: "drive-token",
          refreshToken: "drive-refresh",
        },
        expiresAt: new Date(Date.now() + 3600_000),
        grantedScopes: ["https://www.googleapis.com/auth/drive"],
      },
    );
    await integrationService.connectGmailAccount(
      organisationId,
      "sales@acme.test",
      {
        accessToken: "gmail-token",
        refreshToken: "gmail-refresh",
        expiresAt: new Date(Date.now() + 3600_000),
        scope: "https://mail.google.com/",
      },
    );

    let sentRawMessage = "";
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("gmail.googleapis.com")) {
        const body = JSON.parse(init?.body as string) as { raw: string };
        sentRawMessage = Buffer.from(body.raw, "base64url").toString("utf-8");
        return new Response(JSON.stringify({ id: "sent-1" }), { status: 200 });
      }
      const decoded = decodeURIComponent(urlStr).replace(/\+/g, " ");
      if (decoded.includes("alt=media")) {
        return new Response("quote pdf bytes", { status: 200 });
      }
      if (decoded.includes("mimeType!=")) {
        return new Response(JSON.stringify({ files: [{ id: "file-1" }] }), {
          status: 200,
        });
      }
      // Every folder segment in the attachment's path is found (this test
      // is about attachment resolution, not folder creation).
      return new Response(JSON.stringify({ files: [{ id: "folder-x" }] }), {
        status: 200,
      });
    });

    const result = await client.callTool({
      name: "GMAIL_SEND_EMAIL",
      arguments: {
        to: "buyer@customer-abc.test",
        subject: "Your quote",
        body: "Please find the quote attached.",
        attachments: [
          {
            provider: "google-drive",
            path: ["1042", "Quotation", "quote-final.pdf"],
            mimeType: "application/pdf",
          },
        ],
      },
    });

    expect(result.isError).not.toBe(true);
    expect(sentRawMessage).toContain("Content-Type: multipart/mixed");
    expect(sentRawMessage).toContain('filename="quote-final.pdf"');
    expect(sentRawMessage).toContain(
      Buffer.from("quote pdf bytes").toString("base64"),
    );
  });
});
