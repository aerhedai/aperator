// Which Integration.provider(s) an EMAIL-triggered workflow's bound account
// may be — "send/receive email" is one concept to a business regardless of
// which provider backs it, same reasoning as getValidEmailAccessToken's own
// provider-agnostic resolution. Deliberately its own zero-dependency module:
// workflow-health.ts needs this and must stay importable from a client
// component (it has no Prisma/server dependency of its own), but
// workflow-service.ts does pull in the full server module graph — this
// constant used to live there, which dragged that whole graph into any
// client bundle that imported workflow-health.ts for it.
export const EMAIL_TRIGGER_PROVIDERS = ["gmail", "outlook"] as const;
