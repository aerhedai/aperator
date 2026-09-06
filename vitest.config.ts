import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Same convention as prisma7.config.ts: load .env.local so tests use the
// same DATABASE_URL as the rest of the app (real local Postgres, or
// whatever CI sets — this silently no-ops if the file doesn't exist).
config({ path: ".env.local" });

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Clears organisations stranded by a previously failed run, so a real
    // failure is never buried under Organisation_pkey collisions in
    // unrelated files. See tests/global-setup.ts.
    globalSetup: ["tests/global-setup.ts"],
    // Vitest's 5000ms default is tight for a suite this shape: mixed unit
    // tests alongside integration tests doing real multi-step business
    // logic (provisioning a full org, running an actual harness pipeline)
    // against a real local Postgres. Individually each is comfortably
    // under 5s; under full-suite parallel load, a different one crosses
    // the line on every run — confirmed by three consecutive full runs
    // each failing a different, unrelated test at ~5.1-5.3s, not the same
    // one twice. That pattern means the fix is this number, not any one
    // test's logic — bumping timeouts test-by-test as each one happens to
    // get unlucky is chasing a symptom that will keep recurring elsewhere.
    testTimeout: 20000,
    // testTimeout only governs the test body itself — beforeAll/afterAll
    // hooks are timed separately by hookTimeout, which still defaulted to
    // 10000ms even after the change above. Several integration tests do
    // heavy provisioning (a full org + workflow + several agents) in
    // beforeAll, or multi-step cleanup in afterAll, and under full-suite
    // parallel load those crossed 10s while comfortably under 20s alone.
    // A hook timeout aborts mid-flight rather than failing cleanly, which
    // is why it showed up as cascading, seemingly unrelated failures in
    // other tests in the same file (describe-block variables never
    // assigned, FK violations from half-run cleanup) and as that file's
    // remaining tests being reported "skipped" rather than "failed".
    hookTimeout: 20000,
  },
});
