// One-off helper: install gmail + googlecalendar on the Corsair instance using
// Corsair's platform-managed OAuth (no Google Cloud OAuth app required — Corsair
// provides the client_id/secret/redirect). Idempotent — safe to re-run.
//
// Run (Node 20.6+, loads .env.local):
//   node --env-file=.env.local scripts/provision-corsair.mjs

import { createClient } from "@corsair-dev/app";

const apiKey = process.env.CORSAIR_DEV_KEY;
const instanceId = process.env.CORSAIR_INSTANCE_ID;
if (!apiKey || !instanceId) {
  console.error("✗ CORSAIR_DEV_KEY and CORSAIR_INSTANCE_ID must be set in .env.local.");
  process.exit(1);
}

const inst = createClient({ apiKey }).instance(instanceId);

for (const plugin of ["gmail", "googlecalendar"]) {
  await inst.plugins.upsert(plugin, { authType: "oauth_2", useManaged: true });
  console.log(`✓ ${plugin} — installed with managed OAuth`);
}

console.log("\nDone. Both plugins use Corsair-managed OAuth — connect a Google");
console.log("account via the connect link / authorizeUrl flow, no client_id needed.");
