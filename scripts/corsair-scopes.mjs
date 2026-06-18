// Prints the exact OAuth scopes Corsair requests for gmail + googlecalendar —
// i.e. the only scopes that must stay on the Google consent screen.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { createClient } from "@corsair-dev/app";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function env(k) {
  const t = readFileSync(join(root, ".env.local"), "utf8");
  for (const l of t.split("\n")) {
    const i = l.indexOf("=");
    if (i > 0 && l.slice(0, i).trim() === k) return l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const sql = neon(env("DATABASE_URL"));
const u = await sql.query("SELECT id FROM users ORDER BY created_at LIMIT 1");
const inst = createClient({ apiKey: env("CORSAIR_DEV_KEY") }).instance(env("CORSAIR_INSTANCE_ID"));

for (const p of ["gmail", "googlecalendar"]) {
  const { authorizeUrl } = await inst
    .tenant(u[0].id)
    .plugins.oauth.authorizeUrl(p, "http://localhost:3000/x");
  const scope = new URL(authorizeUrl).searchParams.get("scope") || "";
  console.log(`\n=== ${p} — scopes Corsair requests ===`);
  for (const s of scope.split(/\s+/).filter(Boolean)) console.log("  " + s);
}
process.exit(0);
