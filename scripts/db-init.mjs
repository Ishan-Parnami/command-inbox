// One-shot DB initializer: enables pgvector, then applies the generated Drizzle
// migration + the vector/FTS index file (which can't live in the schema).
// Reads DATABASE_URL from .env.local (drizzle-kit's config doesn't load it).
//
// Usage: node scripts/db-init.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

const url = envFromLocal("DATABASE_URL");
if (!url) {
  console.error("✗ DATABASE_URL not found in env or .env.local");
  process.exit(1);
}
const sql = neon(url);

// Strip `--` line comments, return null if nothing executable remains.
function clean(stmt) {
  const body = stmt
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .trim();
  return body.length ? body : null;
}

async function runStatements(label, statements) {
  let ok = 0;
  for (const raw of statements) {
    const stmt = clean(raw);
    if (!stmt) continue;
    try {
      await sql.query(stmt);
      ok++;
    } catch (err) {
      console.error(`✗ [${label}] failed:\n${stmt.slice(0, 120)}…\n  → ${err.message}`);
      throw err;
    }
  }
  console.log(`✓ ${label}: ${ok} statement(s) applied`);
}

async function main() {
  // 1. Extension must exist before any vector(1024) column is created.
  await sql.query("CREATE EXTENSION IF NOT EXISTS vector");
  console.log("✓ pgvector enabled");

  // 2. Tables (Drizzle separates statements with `--> statement-breakpoint`).
  const init = readFileSync(join(root, "drizzle", "0000_init.sql"), "utf8");
  await runStatements("schema", init.split("--> statement-breakpoint"));

  // 3. Vector/FTS/range indexes (plain `;`-separated). HNSW needs no training.
  const idx = readFileSync(join(root, "drizzle", "hnsw.sql"), "utf8");
  await runStatements("indexes", idx.split(";"));

  // 4. Incremental migrations (0001_*.sql, 0002_*.sql, …).
  const { readdirSync } = await import("node:fs");
  const extras = readdirSync(join(root, "drizzle"))
    .filter((f) => /^000[1-9]\d*_.*\.sql$/.test(f))
    .sort();
  for (const file of extras) {
    const body = readFileSync(join(root, "drizzle", file), "utf8");
    await runStatements(file, body.split(";"));
  }

  // 5. Sanity check.
  const rows = await sql.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'"
  );
  console.log(`✓ public tables now present: ${rows[0].n}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
