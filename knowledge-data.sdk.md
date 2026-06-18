# Corsair Integration Documentation

## Overview
This document outlines the architecture and implementation details for integrating **Corsair SDK** (Self-Hosted) in the Supereye project. We use Corsair to securely connect and fetch data from third-party APIs like Gmail and Google Calendar.

Because we are fully self-hosting Corsair (instead of using the Managed App), all OAuth tokens, integration secrets, and user accounts are stored directly in our own PostgreSQL database alongside our application data (using Drizzle ORM).

---

## 1. Core Architecture

### 1.1 The `corsair.ts` Config
The `corsair.ts` file in the root directory acts as the central initialization hub. It configures the PostgreSQL connection and initializes the Corsair instance with the required plugins (`@corsair-dev/gmail`, `@corsair-dev/googlecalendar`).

**Crucial Note for AI & Devs:** 
The Corsair CLI (`npx corsair setup`, `npx corsair auth`) relies on finding this `corsair.ts` file in the project root to know which database to target and what KEK (Key Encryption Key) to use. Do not move or rename this file without updating CLI commands.

### 1.2 Multi-Tenancy
We configured the SDK with `multiTenancy: true`. In Corsair, a "Tenant" maps 1-to-1 with a User in our application. When a user signs up for Supereye, their unique User ID (e.g., from our Auth provider) becomes their Corsair `tenantId`. This ensures data isolation.

---

## 2. Setting Up Integrations (Application Level)

Before users can log in, the Supereye application itself needs to be authorized with Google.

1. Generate a Client ID and Client Secret from the [Google Cloud Console](https://console.cloud.google.com/).
2. Ensure your OAuth consent screen includes the necessary scopes:
   - `https://mail.google.com/` (Gmail)
   - `https://www.googleapis.com/auth/calendar` (Calendar)
3. Inject the application credentials into the local database using the CLI:

```bash
npx corsair setup --googlecalendar client_id=YOUR_ID client_secret=YOUR_SECRET
npx corsair setup --gmail client_id=YOUR_ID client_secret=YOUR_SECRET topic_id=dummy-topic
```
*(This saves the Google OAuth app credentials into the `corsair_integrations` table).*

---

## 3. User Authentication (Production Workflow)

To fetch data for actual users in the Next.js app, we must handle the Google OAuth flow so users can grant Supereye permission to read their data.

> **Correction (verified against the installed SDK, `corsair@^0.1.76`):** the OAuth
> helpers are standalone functions in `corsair/oauth` — `generateOAuthUrl` and
> `processOAuthCallback`. There is **no** `corsair[plugin].oauth.getAuthUrl(...)`.
> `toNextJsHandler(corsair)` exists but is the SDK's **management API** handler,
> not the OAuth callback. We therefore write our own callback route. In this repo
> these are wrapped in `src/lib/corsair/client.ts` as `getAuthUrl()` / `completeOAuth()`.

### 3.1 The Next.js API Route (Callback Handler)
Production needs an HTTP callback route that we own. Create `app/api/corsair/callback/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { completeOAuth } from "@/lib/corsair/client"; // wraps processOAuthCallback

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(new URL("/", req.url));

  const { plugin, tenantId } = await completeOAuth(code, state);
  // ...record connection + kick off initial sync...
  return NextResponse.redirect(new URL("/", req.url));
}
```

Under the hood `completeOAuth` calls:
```typescript
import { processOAuthCallback } from "corsair/oauth";
await processOAuthCallback(corsair, { code, state, redirectUri });
```

### 3.2 Generating the Auth URL
When a user clicks "Connect Gmail", generate the URL with `generateOAuthUrl` and redirect:

```typescript
import { generateOAuthUrl } from "corsair/oauth";
import { corsair } from "@/corsair";

// Inside an API route (see src/lib/corsair/client.ts -> getAuthUrl):
export async function getAuthUrl(userId: string, plugin: "gmail" | "googlecalendar") {
  return generateOAuthUrl(corsair, plugin, {
    tenantId: userId, // locks the resulting tokens to this user
    redirectUri: `${process.env.NEXT_PUBLIC_URL}/api/corsair/callback`,
  });
}
```

**What happens next?**
1. The user signs in with Google.
2. Google redirects to `/api/corsair/callback?code=…&state=…`.
3. Our route calls `processOAuthCallback`, which exchanges the code and saves the
   (encrypted) `access_token`/`refresh_token` to `corsair_accounts` for that `tenantId`.

---

## 4. Fetching User Data (Live vs Cached)

Once the user has authenticated (their tokens exist in `corsair_accounts`), call the
plugin API through a tenant scope. `.api.*` returns data directly and throws
`AuthMissingError` if the user isn't connected; `.db.*` reads the cached mirror:

```typescript
import { corsair } from "@/corsair";

const t = corsair.withTenant(userId);
const live = await t.gmail.api.messages.list({ data: { maxResults: 25 } });
const cached = await t.gmail.db.messages.search({ data: { q: "from:boss" } });
```