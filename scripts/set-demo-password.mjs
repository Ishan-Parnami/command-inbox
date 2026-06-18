// Set or update a user's demo login password (bcrypt hash in users.password_hash).
// Reads DATABASE_URL from env or .env.local.
//
// Usage: node scripts/set-demo-password.mjs <email> <password>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { hash } from "bcryptjs";
import { neon } from "@neondatabase/serverless";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  const txt = readFileSync(join(root, ".env.local"), "utf8");
  for (const line of txt.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() === key) {
      return line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

const [emailArg, passwordArg] = process.argv.slice(2);
if (!emailArg || !passwordArg) {
  console.error("Usage: node scripts/set-demo-password.mjs <email> <password>");
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const url = envFromLocal("DATABASE_URL");
if (!url) {
  console.error("✗ DATABASE_URL not found in env or .env.local");
  process.exit(1);
}

const sql = neon(url);
const passwordHash = await hash(passwordArg, 12);

const rows = await sql`
  UPDATE users
  SET password_hash = ${passwordHash}, updated_at = NOW()
  WHERE email = ${email}
  RETURNING id, email
`;

if (rows.length === 0) {
  console.error(`✗ No user found with email: ${email}`);
  console.error("  Create the user first (e.g. sign in with Google once), then rerun.");
  process.exit(1);
}

console.log(`✓ Password set for ${rows[0].email} (${rows[0].id})`);
