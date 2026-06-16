# Command Inbox

A Superhuman-style Gmail & Google Calendar command center. Built with **Next.js**, **PostgreSQL**, and **Corsair** for real-time email and calendar management with AI-powered prioritization, keyboard shortcuts, and MCP agent chat.

## ✨ Features

### Core
- **Real-time Gmail & Calendar** — Instant sync via Corsair webhooks
- **AI Priority Inbox** — Gemini classifies emails (Urgent → Normal → Low)
- **Keyboard-first UI** — Full Vim keybindings (j/k, e for archive, c for compose, n for natural compose)
- **Natural Compose** — Press `N`, type "Lunch with Sara tomorrow 1pm" or "Email John about the sprint" → pre-filled event or compose
- **Command Palette** — ⌘K for instant actions
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
- API keys:
  - [Corsair](https://corsair.dev)
  - [Google AI Studio](https://aistudio.google.com/apikey) (Gemini — free; LLM + embeddings)

### Setup

1. **Clone & install:**
```bash
git clone <repo>
cd command-inbox
pnpm install
```

2. **Environment variables:**
Copy `.env.example` to `.env.local` and fill in:
```bash
NEXT_PUBLIC_URL=http://localhost:3000
DATABASE_URL=postgresql://...
CORSAIR_DEV_KEY=<your-dev-key>
CORSAIR_INSTANCE_ID=<your-instance-id>
GEMINI_API_KEY=<your-api-key>
UPSTASH_REDIS_REST_URL=<your-upstash-url>
UPSTASH_REDIS_REST_TOKEN=<your-upstash-token>
```

3. **Setup database:**
```bash
pnpm drizzle-kit push
```

4. **Run dev server:**
```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## 📋 Corsair Features Used

✅ **Core API** — Send/archive emails, create/list calendar events  
✅ **OAuth Proxy** — Secure Google authentication  
✅ **Webhooks** — Real-time Gmail & Calendar sync  
✅ **MCP Server** — Agentic email/calendar actions  
✅ **Search API** — Live Gmail search integration  

## 🎯 Bonus Features Implemented

- [ ] Vector embeddings + semantic search (pgvector + Gemini)
- [ ] Pre-meeting AI brief
- [ ] MCP agent multi-step actions
- [ ] Keyboard shortcut customization
- [ ] Email snoozed reminder system
- [ ] Send later scheduling
- [ ] Contact intelligence

## 📚 Detailed Planning

Full implementation roadmap, database schema, and feature specs in [builder-mode.md](./builder-mode.md).

## 🚢 Deployment

Deploy to Vercel:
```bash
vercel --prod
```

Set all env vars in Vercel dashboard, then update Corsair webhook URL to production domain.

## 📄 License

MIT
