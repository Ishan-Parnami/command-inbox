// Configures the Corsair OAuth proxy to use YOUR Google OAuth client for
// gmail + googlecalendar. Reuses AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from
// .env.local. The redirect_url is Corsair's hosted callback — you must also add
// it to the Google client's "Authorized redirect URIs".
//
// Usage: node scripts/corsair-credentials.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { createClient } from "@corsair-dev/app";

const CORSAIR_REDIRECT_URL = "https://api.corsair.dev/oauth/callback";

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

const clientId = env("AUTH_GOOGLE_ID");
const clientSecret = env("AUTH_GOOGLE_SECRET");
if (!clientId || !clientSecret) {
  console.error("✗ AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET missing in .env.local");
  process.exit(1);
}

const inst = createClient({ apiKey: env("CORSAIR_DEV_KEY") }).instance(env("CORSAIR_INSTANCE_ID"));

for (const p of ["gmail", "googlecalendar"]) {
  await inst.plugins.credentials.setRoot(p, "client_id", clientId);
  await inst.plugins.credentials.setRoot(p, "client_secret", clientSecret);
  await inst.plugins.credentials.setRoot(p, "redirect_url", CORSAIR_REDIRECT_URL);
  console.log(`✓ ${p}: client_id + client_secret + redirect_url set`);
}

// Confirm authorizeUrl now works for the signed-in user.
const sql = neon(env("DATABASE_URL"));
const users = await sql.query("SELECT id, email FROM users ORDER BY created_at LIMIT 1");
if (users.length) {
  const userId = users[0].id;
  for (const p of ["gmail", "googlecalendar"]) {
    try {
      const { authorizeUrl } = await inst
        .tenant(userId)
        .plugins.oauth.authorizeUrl(p, `http://localhost:3000/api/corsair/connected?provider=${p}`);
      console.log(`✓ ${p} authorizeUrl OK: ${authorizeUrl.slice(0, 70)}…`);
    } catch (e) {
      console.error(`✗ ${p} authorizeUrl: ${e.message}`);
    }
  }
}
process.exit(0);
