// Read-only: confirms the Corsair OAuth proxy can now mint authorize URLs for
// the real signed-in user (i.e. oauth_client_id_missing is resolved).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";
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

const sql = neon(env("DATABASE_URL"));
const users = await sql.query("SELECT id, email FROM users ORDER BY created_at LIMIT 1");
if (!users.length) {
  console.error("✗ no users row — sign in first");
  process.exit(1);
}
const userId = users[0].id;
console.log(`user: ${users[0].email} (${userId})`);

const inst = createClient({ apiKey: env("CORSAIR_DEV_KEY") }).instance(env("CORSAIR_INSTANCE_ID"));
for (const p of ["gmail", "googlecalendar"]) {
  try {
    const { authorizeUrl } = await inst
      .tenant(userId)
      .plugins.oauth.authorizeUrl(p, `http://localhost:3000/api/corsair/connected?provider=${p}`);
    console.log(`✓ ${p}: ${authorizeUrl.slice(0, 90)}…`);
  } catch (e) {
    console.error(`✗ ${p}: ${e.message}`);
  }
}
process.exit(0);
