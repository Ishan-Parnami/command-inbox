-- Corsair self-hosted SDK tables. Idempotent (CREATE TABLE IF NOT EXISTS) and
-- ordered so inline foreign keys resolve. On an existing DB prefer `pnpm db:push`;
-- this file keeps `pnpm db:init` (which globs 000N_*.sql) correct for fresh setups.

CREATE TABLE IF NOT EXISTS "corsair_integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dek" text
);

CREATE TABLE IF NOT EXISTS "corsair_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" text NOT NULL,
	"integration_id" text NOT NULL REFERENCES "corsair_integrations"("id"),
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dek" text
);

CREATE TABLE IF NOT EXISTS "corsair_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" text NOT NULL REFERENCES "corsair_accounts"("id"),
	"entity_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"version" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "corsair_events" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" text NOT NULL REFERENCES "corsair_accounts"("id"),
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text
);
