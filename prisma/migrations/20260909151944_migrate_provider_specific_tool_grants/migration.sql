-- Migrates existing AgentTool grants from the eight retired shared,
-- branching tool names to their provider-specific replacements (see
-- docs/provider-specific-tools-design.md). A grant naming a tool that no
-- longer exists would silently stop an agent doing something it was
-- configured to do — the exact failure mode
-- 20260903120000_consolidate_tool_names already established this
-- insert-then-delete, ON-CONFLICT-DO-NOTHING pattern to avoid.
--
-- Two resolution shapes, depending on whether the old tool's own behavior
-- could ever be disambiguated per-agent:
--
-- Calendar tools (check_calendar_availability, create_calendar_event) are
-- a plain 1:1 rename — Outlook Calendar is the only calendar provider that
-- has ever existed.
--
-- Email tools (send_email, read_inbox) resolve via Agent.actionIntegrationId:
-- agent-service.ts's ACTION_ACCOUNT_PROVIDERS has only ever allowed that
-- field to be a Gmail or Outlook account, so a bound account
-- unambiguously picks one. Unbound agents (or, defensively, a bound
-- account that isn't actually gmail/outlook) get both — the old tool
-- already resolved to "whichever is connected" at call time via
-- getValidEmailAccessToken, so granting both preserves that.
--
-- Chat and storage tools (notify_channel; create_folder, save_file,
-- populate_template) have no equivalent to resolve from: which platform/
-- provider they reached was always a *call-time* argument
-- (platform/provider), never anything stored per-agent. Every agent that
-- held one of these grants gets both provider-specific replacements
-- unconditionally — narrowing to a guess would silently remove a
-- capability the agent may have genuinely used; over-granting is
-- harmless, since each provider-specific tool already fails cleanly with
-- its own "not connected" error at call time regardless of whether it's
-- actually reachable.

-- Calendar tools: 1:1 rename.
INSERT INTO "AgentTool" ("id", "agentId", "toolName")
SELECT gen_random_uuid()::text, "agentId",
  CASE "toolName"
    WHEN 'check_calendar_availability' THEN 'OUTLOOK_CHECK_CALENDAR_AVAILABILITY'
    WHEN 'create_calendar_event' THEN 'OUTLOOK_CREATE_CALENDAR_EVENT'
  END
FROM "AgentTool"
WHERE "toolName" IN ('check_calendar_availability', 'create_calendar_event')
ON CONFLICT ("agentId", "toolName") DO NOTHING;

-- Email tools: resolve via the agent's bound account when it's specifically
-- Gmail or Outlook; both otherwise.
INSERT INTO "AgentTool" ("id", "agentId", "toolName")
SELECT gen_random_uuid()::text, at."agentId", 'GMAIL_' || (
  CASE at."toolName" WHEN 'send_email' THEN 'SEND_EMAIL' WHEN 'read_inbox' THEN 'READ_INBOX' END
)
FROM "AgentTool" at
JOIN "Agent" a ON a.id = at."agentId"
LEFT JOIN "Integration" bound ON bound.id = a."actionIntegrationId"
WHERE at."toolName" IN ('send_email', 'read_inbox')
  AND bound.provider IS DISTINCT FROM 'outlook'
ON CONFLICT ("agentId", "toolName") DO NOTHING;

INSERT INTO "AgentTool" ("id", "agentId", "toolName")
SELECT gen_random_uuid()::text, at."agentId", 'OUTLOOK_' || (
  CASE at."toolName" WHEN 'send_email' THEN 'SEND_EMAIL' WHEN 'read_inbox' THEN 'READ_INBOX' END
)
FROM "AgentTool" at
JOIN "Agent" a ON a.id = at."agentId"
LEFT JOIN "Integration" bound ON bound.id = a."actionIntegrationId"
WHERE at."toolName" IN ('send_email', 'read_inbox')
  AND bound.provider IS DISTINCT FROM 'gmail'
ON CONFLICT ("agentId", "toolName") DO NOTHING;

-- Chat tool: unconditionally both.
INSERT INTO "AgentTool" ("id", "agentId", "toolName")
SELECT gen_random_uuid()::text, "agentId", 'SLACK_POST_MESSAGE'
FROM "AgentTool" WHERE "toolName" = 'notify_channel'
ON CONFLICT ("agentId", "toolName") DO NOTHING;

INSERT INTO "AgentTool" ("id", "agentId", "toolName")
SELECT gen_random_uuid()::text, "agentId", 'TEAMS_POST_MESSAGE'
FROM "AgentTool" WHERE "toolName" = 'notify_channel'
ON CONFLICT ("agentId", "toolName") DO NOTHING;

-- Storage tools: unconditionally both, per tool.
INSERT INTO "AgentTool" ("id", "agentId", "toolName")
SELECT gen_random_uuid()::text, "agentId", 'GOOGLE_DRIVE_' || (
  CASE "toolName"
    WHEN 'create_folder' THEN 'CREATE_FOLDER'
    WHEN 'save_file' THEN 'SAVE_FILE'
    WHEN 'populate_template' THEN 'POPULATE_TEMPLATE'
  END
)
FROM "AgentTool"
WHERE "toolName" IN ('create_folder', 'save_file', 'populate_template')
ON CONFLICT ("agentId", "toolName") DO NOTHING;

INSERT INTO "AgentTool" ("id", "agentId", "toolName")
SELECT gen_random_uuid()::text, "agentId", 'SHAREPOINT_' || (
  CASE "toolName"
    WHEN 'create_folder' THEN 'CREATE_FOLDER'
    WHEN 'save_file' THEN 'SAVE_FILE'
    WHEN 'populate_template' THEN 'POPULATE_TEMPLATE'
  END
)
FROM "AgentTool"
WHERE "toolName" IN ('create_folder', 'save_file', 'populate_template')
ON CONFLICT ("agentId", "toolName") DO NOTHING;

-- Every old name is now represented by at least one replacement, so the
-- old rows go.
DELETE FROM "AgentTool"
WHERE "toolName" IN (
  'send_email', 'read_inbox', 'notify_channel',
  'check_calendar_availability', 'create_calendar_event',
  'create_folder', 'save_file', 'populate_template'
);
