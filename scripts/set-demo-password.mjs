// Set or update a demo password for an existing user (must have signed in via Google once).
//
// Usage:
//   pnpm set-demo-password atish1625@gmail.com MyDemoPass123
//
// Reads DATABASE_URL from .env.local. Does not enable login — set DEMO_LOGIN_ENABLED=true for that.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { hash } from "bcryptjs";
import { neon } from "@neondatabase/serverless";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  try {
    const txt = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      if (line.slice(0, eq).trim() === key) {
        return line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env.local */
  }
  return undefined;
}

const email = process.argv[2]?.trim().toLowerCase();
const password = process.argv[3];

if (!email || !password) {
  console.error("Usage: pnpm set-demo-password <email> <password>");
  console.error("User must already exist (signed in via Google at least once).");
  process.exit(1);
}

if (password.length < 8) {
  console.error("✗ Password must be at least 8 characters.");
  process.exit(1);
}

const url = envFromLocal("DATABASE_URL");
if (!url) {
  console.error("✗ DATABASE_URL not found in env or .env.local");
  process.exit(1);
}

const sql = neon(url);
const rows = await sql`SELECT id, email FROM users WHERE email = ${email}`;
if (!rows.length) {
  console.error(`✗ No user with email ${email}. They must sign in with Google once first.`);
  process.exit(1);
}

const passwordHash = await hash(password, 12);
await sql`UPDATE users SET password_hash = ${passwordHash}, updated_at = NOW() WHERE email = ${email}`;

console.log(`✓ Demo password set for ${email}`);
console.log("  Enable login: DEMO_LOGIN_ENABLED=true in .env.local / Vercel");
