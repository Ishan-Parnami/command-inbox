import type { Config } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

if (!process.env.DATABASE_URL) {
  loadEnv({ path: ".env.local" });
  loadEnv();
}

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
