// Configures the Corsair instance so the hosted OAuth proxy works for Gmail +
// Google Calendar. Uses Corsair-managed OAuth credentials (useManaged) so we
// don't have to register our own Google OAuth app with Corsair.
//
// Usage: node scripts/corsair-setup.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@corsair-dev/app";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function env(key) {
  if (process.env[key]) return process.env[key];
  const txt = readFileSync(join(root, ".env.local"), "utf8");
  for (const line of txt.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0 && line.slice(0, eq).trim() === key) {
      return line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

const apiKey = env("CORSAIR_DEV_KEY");
const instanceId = env("CORSAIR_INSTANCE_ID");
if (!apiKey || !instanceId) {
  console.error("✗ CORSAIR_DEV_KEY / CORSAIR_INSTANCE_ID missing");
  process.exit(1);
}

const inst = createClient({ apiKey }).instance(instanceId);

async function main() {
  const before = await inst.plugins.list();
  console.log("── Installed plugins (before) ──");
  console.dir(before, { depth: 4 });

  for (const pluginId of ["gmail", "googlecalendar"]) {
    try {
      const r = await inst.plugins.upsert(pluginId, { authType: "oauth_2", useManaged: true });
      console.log(`✓ ${pluginId}: ${r.created ? "created" : "updated"} (managed oauth)`);
    } catch (e) {
      console.error(`✗ ${pluginId}: ${e.message}`);
    }
  }

  const after = await inst.plugins.list();
  console.log("── Installed plugins (after) ──");
  console.dir(after, { depth: 4 });
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
