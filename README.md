# Command Inbox

A Superhuman-style Gmail & Google Calendar command center. Built with **Next.js**, **PostgreSQL**, and **Corsair** for real-time email and calendar management with AI-powered prioritization, keyboard shortcuts, and MCP agent chat.

## ✨ Features

### Core
- **Gmail & Calendar sync** — Near real-time via polling (~50s) + scheduled cron; webhook ingest wired (`processWebhook`)
- **AI Priority Inbox** — Gemini classifies emails (Urgent → Normal → Low)
- **Keyboard-first UI** — Full Vim keybindings (j/k, e for archive, c for compose, n for natural compose)
- **Natural Compose** — Press `N`, type "Lunch with Sara tomorrow 1pm" or "Email John about the sprint" → pre-filled event or compose
- **Command Palette** — ⌘K for instant actions; ⌘F for AI search; ⌘/ for AI assistant
- **Action Board** — Auto-extracted to-dos from emails
- **Contacts** — Full CRUD (add, rename, delete, VIP) with global alias resolution: saved names auto-resolve to emails in Mail, Calendar, and the AI assistant

### Advanced
- **MCP Agent Chat** — Natural language: "Email X and create event" → executes both
- **Semantic Search** — pgvector + Gemini embeddings (< 100ms local search)
- **Pre-Meeting Brief** — 30 min before event, AI summarizes attendee context
- **Undo Send** — 10-second grace period before email goes out
- **Conflict Detection** — Never double-book calendar events

## 🛠 Tech Stack

- **Frontend:** Next.js 16, React, TypeScript, Tailwind CSS
- **Backend:** Next.js Route Handlers + Server Actions
- **Database:** PostgreSQL (Neon) + pgvector for embeddings
- **ORM:** Drizzle
- **AI:** Gemini (Flash-Lite for classification, Flash for agent)
- **Embeddings:** Gemini (`gemini-embedding-001`, 1024-dim vectors)
- **Integrations:** Corsair (Gmail + Calendar APIs, OAuth, webhooks)

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL (Neon free tier works)
- API keys / secrets:
  - Google OAuth client (`AUTH_GOOGLE_ID`/`SECRET`) from Google Cloud Console
  - `CORSAIR_KEK` — generate locally with `openssl rand -base64 32` (self-hosted SDK; no Corsair API key needed)
  - [Google AI Studio](https://aistudio.google.com/apikey) (Gemini — free; LLM + embeddings)

### Setup

1. **Clone & install:**
```bash
git clone <repo>
cd command-inbox
pnpm install
```

2. **Environment variables:**
Copy `.env.example` to `.env.local` and fill in (see file for full list):
```bash
NEXT_PUBLIC_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<openssl rand -base64 32>
AUTH_GOOGLE_ID=<google-oauth-client-id>
AUTH_GOOGLE_SECRET=<google-oauth-client-secret>
DATABASE_URL=postgresql://...
# Corsair self-hosted SDK
CORSAIR_KEK=<openssl rand -base64 32>   # encrypts stored OAuth tokens — never lose/rotate
CORSAIR_WEBHOOK_SECRET=<optional hmac secret>
# Optional: separate OAuth client for Corsair. Defaults to AUTH_GOOGLE_* if unset.
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GEMINI_API_KEY=<your-api-key>
```

3. **Setup database:**
```bash
pnpm db:init
```
(Applies schema + pgvector HNSW/FTS indexes. Alternative: `pnpm drizzle-kit push` then run `drizzle/hnsw.sql` manually.)

On an existing database, apply only the new migration with `pnpm db:push` (additive: it adds the four `corsair_*` tables).

4. **Connect Google (one-time, self-hosted OAuth):**
```bash
# Register the redirect URI in Google Cloud Console → Credentials → your OAuth client:
#   http://localhost:3000/api/corsair/callback   (and your prod URL)
# Seed integration-level OAuth credentials (uses the root corsair.ts config):
pnpm corsair setup --gmail client_id=$AUTH_GOOGLE_ID client_secret=$AUTH_GOOGLE_SECRET
pnpm corsair setup --googlecalendar client_id=$AUTH_GOOGLE_ID client_secret=$AUTH_GOOGLE_SECRET
```
Then each user connects from the app UI; tokens are stored per-tenant in `corsair_accounts`.

5. **Run dev server:**
```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## 📋 Corsair Features Used

✅ **Core API** — Send/archive emails, create/list calendar events  
✅ **Self-hosted OAuth** — Per-user Google auth, tokens encrypted in your DB (`CORSAIR_KEK`)  
✅ **Webhooks** — `processWebhook` ingest + local mirror (real-time push deferred)  
✅ **Agent actions** — Gemini function calling over the Corsair API  
✅ **Search API** — Cached Gmail message search  

## 🎯 Bonus Features Implemented

- [x] Vector embeddings + semantic search (pgvector + Gemini)
- [x] Pre-meeting AI brief
- [x] MCP agent multi-step actions
- [ ] Keyboard shortcut customization (schema ready, UI not wired)
- [x] Email snoozed reminder system
- [x] Send later scheduling
- [x] Contact intelligence

## 📚 Detailed Planning

Full implementation roadmap, database schema, and feature specs in [builder-mode.md](./builder-mode.md).

## 🚢 Deployment

Deploy to Vercel:
```bash
vercel --prod
```

1. Set all env vars in the host dashboard (incl. `CORSAIR_KEK`, `DATABASE_URL`).
2. Apply DB changes: `pnpm db:push` (adds the 4 `corsair_*` tables) and run the `pnpm corsair setup` commands once against prod.
3. Google Cloud Console: add the production redirect URI `<NEXT_PUBLIC_URL>/api/corsair/callback` and the Gmail + Calendar scopes (submit for verification to serve non-test users).
4. Schedule the cron endpoints on an external scheduler (cron-job.org / UptimeRobot), e.g. GET `https://<app>/api/cron/calendar-sync?token=<CRON_SECRET>` (also `send-later`, `snooze`). Use `Authorization: Bearer <CRON_SECRET>` where headers are supported.

## 📄 License

MIT
