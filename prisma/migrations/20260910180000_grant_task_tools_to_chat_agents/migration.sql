-- create_task/create_routine join chat-agent-service.ts's DEFAULT_TOOL_NAMES
-- (Tasks and Routines), but that list is only applied at
-- getOrCreateChatAgent's first-ever call for an organisation — every
-- organisation whose CHAT-mode agent already existed before this migration
-- would otherwise never see these two new tools. Data-only, no schema
-- change: same reasoning and idempotent shape (ON CONFLICT DO NOTHING) as
-- 20260903120000_consolidate_tool_names.
--
-- Every organisation has at most one CHAT-mode agent (chat-agent-service.ts's
-- own enforced rule), so this is a plain grant, not a rename/collapse — no
-- DELETE half needed.

INSERT INTO "AgentTool" ("id", "agentId", "toolName")
SELECT gen_random_uuid()::text, "id", tool_name
FROM "Agent"
CROSS JOIN (VALUES ('create_task'), ('create_routine')) AS tools(tool_name)
WHERE "executionMode" = 'CHAT'
ON CONFLICT DO NOTHING;
