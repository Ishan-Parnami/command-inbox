# Command Inbox

A Superhuman-style Gmail & Google Calendar command center. Built with **Next.js**, **PostgreSQL**, and **Corsair** for real-time email and calendar management with AI-powered prioritization, keyboard shortcuts, and MCP agent chat.

## ✨ Features

### Core
- **Real-time Gmail & Calendar** — Instant sync via Corsair webhooks
- **AI Priority Inbox** — Claude Haiku classifies emails (Urgent → Normal → Low)
- **Keyboard-first UI** — Full Vim keybindings (j/k, e for archive, c for compose)
- **Command Palette** — ⌘K for instant actions
- **Action Board** — Auto-extracted to-dos from emails

### Advanced
- **MCP Agent Chat** — Natural language: "Email X and create event" → executes both
- **Semantic Search** — pgvector + Voyage AI embeddings (< 100ms local search)
- **Pre-Meeting Brief** — 30 min before event, AI summarizes attendee context
- **Undo Send** — 10-second grace period before email goes out
- **Conflict Detection** — Never double-book calendar events

## 🛠 Tech Stack

- **Frontend:** Next.js 14, React, TypeScript, Tailwind CSS
- **Backend:** Next.js API routes, NextAuth
- **Database:** PostgreSQL (Neon) + pgvector for embeddings
- **ORM:** Drizzle
- **AI:** Claude (Haiku for classification, Sonnet for agent)
- **Embeddings:** Voyage AI (1024-dim vectors)
- **Integrations:** Corsair (Gmail + Calendar APIs)

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL (Neon free tier works)
- API keys:
  - [Corsair](https://corsair.dev)
  - [Anthropic](https://console.anthropic.com)
  - [Voyage AI](https://voyageai.com) (optional, for semantic search)

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
CORSAIR_API_KEY=<your-api-key>
ANTHROPIC_API_KEY=<your-api-key>
VOYAGE_API_KEY=<your-api-key>  # optional
NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>
TOKEN_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>
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

- [ ] Vector embeddings + semantic search (pgvector + Voyage AI)
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
