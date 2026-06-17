// Self-hosted Corsair SDK instance. Single source of truth for the SDK config.
//
// IMPORTANT: keep this file at the project root. The Corsair CLI
// (`pnpm corsair setup`, `pnpm corsair auth`) discovers it here to know which
// database/KEK to target. Do not add `import "server-only"` — the CLI loads this
// file outside Next.js, where `server-only` throws.
import { config as loadEnv } from "dotenv";
import { Pool } from "pg";
import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";

// Next.js loads .env.local automatically, but the CLI/scripts do not. Hydrate
// from .env.local (then .env) only when the required vars are not already set.
if (!process.env.CORSAIR_KEK || !process.env.DATABASE_URL) {
  loadEnv({ path: ".env.local" });
  loadEnv();
}

// Corsair needs a pg-compatible Pool. The app's own tables keep using the Neon
// HTTP driver (see src/lib/db); this dedicated pool is only for the SDK.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// OAuth client_id/client_secret are integration-level credentials stored in
// `corsair_integrations` via `pnpm corsair setup` (see README). They are NOT
// configured here. Per-tenant access/refresh tokens are written by
// processOAuthCallback after each user authorizes.
export const corsair = createCorsair({
  multiTenancy: true,
  database: pool,
  kek: process.env.CORSAIR_KEK!,
  plugins: [gmail({ authType: "oauth_2" }), googlecalendar({ authType: "oauth_2" })],
});
