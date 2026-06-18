import { config as loadEnv } from "dotenv";
import { Pool } from "pg";
import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";
import { normalizePgConnectionString } from "./lib/pg-connection-string";

// Next.js loads .env.local automatically, but the CLI/scripts do not. Hydrate
// from .env.local (then .env) only when the required vars are not already set.
if (!process.env.CORSAIR_KEK || !process.env.DATABASE_URL) {
  loadEnv({ path: ".env.local" });
  loadEnv();
}

const pool = new Pool({
  connectionString: normalizePgConnectionString(process.env.DATABASE_URL!),
});

export const corsair = createCorsair({
  multiTenancy: true,
  database: pool,
  kek: process.env.CORSAIR_KEK!,
  plugins: [gmail({ authType: "oauth_2" }), googlecalendar({ authType: "oauth_2" })],
});
