// Read-only: dumps instance detail + the root credential fields Corsair expects
// for gmail/googlecalendar (so we know what to set and the redirect URL to use).
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
}

const inst = createClient({ apiKey: env("CORSAIR_DEV_KEY") }).instance(env("CORSAIR_INSTANCE_ID"));

console.log("── instance.get() ──");
console.dir(await inst.get(), { depth: 6 });

for (const p of ["gmail", "googlecalendar"]) {
  console.log(`── credentials.list("${p}") ──`);
  try {
    console.dir(await inst.plugins.credentials.list(p), { depth: 6 });
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
  }
}
process.exit(0);
