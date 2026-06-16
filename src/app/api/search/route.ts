import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { emails, emailVectors, emailThreads } from "@/lib/db/schema";
import { embed } from "@/lib/gemini/client";
import { searchCachedMessages } from "@/lib/corsair/client";
import { CorsairAuthError } from "@/lib/corsair/client";

type Hit = {
  gmailMessageId: string;
  threadId: string | null;
  subject: string | null;
  snippet: string | null;
  fromName: string | null;
  fromEmail: string | null;
  receivedAt: string | null;
  source: "vector" | "fts" | "corsair";
  score: number;
};

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ hits: [] });

  const [vectorResult, ftsResult, corsairResult] = await Promise.allSettled([
    // Mode 1: pgvector cosine similarity (needs embeddings populated)
    (async (): Promise<Hit[]> => {
      const vec = await embed(q, "RETRIEVAL_QUERY");
      const vecStr = `[${vec.join(",")}]`;
      const rows = await db
        .select({
          emailId: emailVectors.emailId,
          similarity: sql<number>`1 - (${emailVectors.embedding} <=> ${vecStr}::vector)`,
        })
        .from(emailVectors)
        .where(sql`(1 - (${emailVectors.embedding} <=> ${vecStr}::vector)) > 0.72`)
        .orderBy(sql`${emailVectors.embedding} <=> ${vecStr}::vector`)
        .limit(10);

      if (!rows.length) return [];
      const emailRows = await db
        .select()
        .from(emails)
        .where(and(eq(emails.userId, userId), sql`${emails.id} = ANY(ARRAY[${sql.join(rows.map((r) => sql`${r.emailId}::uuid`), sql`, `)}])`));

      const simMap = Object.fromEntries(rows.map((r) => [r.emailId, r.similarity]));
      return emailRows.map((e) => ({
        gmailMessageId: e.gmailMessageId,
        threadId: e.threadId,
        subject: e.subject,
        snippet: e.bodySnippet,
        fromName: e.fromName,
        fromEmail: e.fromEmail,
        receivedAt: e.receivedAt?.toISOString() ?? null,
        source: "vector" as const,
        score: simMap[e.id] ?? 0,
      }));
    })(),

    // Mode 2: Full-text search on subject + snippet
    (async (): Promise<Hit[]> => {
      const rows = await db
        .select({
          id: emails.id,
          gmailMessageId: emails.gmailMessageId,
          threadId: emails.threadId,
          subject: emails.subject,
          snippet: emails.bodySnippet,
          fromName: emails.fromName,
          fromEmail: emails.fromEmail,
          receivedAt: emails.receivedAt,
          rank: sql<number>`ts_rank(
            to_tsvector('english', coalesce(${emails.subject}, '') || ' ' || coalesce(${emails.bodySnippet}, '')),
            plainto_tsquery('english', ${q})
          )`,
        })
        .from(emails)
        .where(
          and(
            eq(emails.userId, userId),
            sql`to_tsvector('english', coalesce(${emails.subject}, '') || ' ' || coalesce(${emails.bodySnippet}, '')) @@ plainto_tsquery('english', ${q})`
          )
        )
        .orderBy(sql`rank desc`)
        .limit(10);

      return rows.map((e) => ({
        gmailMessageId: e.gmailMessageId,
        threadId: e.threadId,
        subject: e.subject,
        snippet: e.snippet,
        fromName: e.fromName,
        fromEmail: e.fromEmail,
        receivedAt: e.receivedAt?.toISOString() ?? null,
        source: "fts" as const,
        score: e.rank,
      }));
    })(),

    // Mode 3: Corsair-cached live Gmail search
    (async (): Promise<Hit[]> => {
      const res = (await searchCachedMessages(userId, q, 10)) as { messages?: Array<{ id: string; threadId: string; snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } }> };
      const msgs = res.messages ?? [];
      return msgs.map((m) => {
        const headers = m.payload?.headers ?? [];
        const sub = headers.find((h: { name: string }) => h.name.toLowerCase() === "subject")?.value ?? null;
        const from = headers.find((h: { name: string }) => h.name.toLowerCase() === "from")?.value ?? null;
        return {
          gmailMessageId: m.id,
          threadId: m.threadId ?? null,
          subject: sub,
          snippet: m.snippet ?? null,
          fromName: null,
          fromEmail: from,
          receivedAt: null,
          source: "corsair" as const,
          score: 0.5,
        };
      });
    })(),
  ]);

  // Merge — deduplicate by gmailMessageId, prefer higher source priority.
  const merged = new Map<string, Hit>();
  const priority = { vector: 3, fts: 2, corsair: 1 };

  for (const result of [vectorResult, ftsResult, corsairResult]) {
    if (result.status !== "fulfilled") continue;
    for (const hit of result.value) {
      const existing = merged.get(hit.gmailMessageId);
      if (!existing || priority[hit.source] > priority[existing.source]) {
        merged.set(hit.gmailMessageId, hit);
      }
    }
  }

  const hits = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 20);

  // Resolve threadId (our internal uuid) from emails table for threading.
  const gmailIds = hits.map((h) => h.gmailMessageId);
  if (gmailIds.length) {
    const emailRows = await db
      .select({ gmailMessageId: emails.gmailMessageId, threadId: emails.threadId })
      .from(emails)
      .where(and(eq(emails.userId, userId), sql`${emails.gmailMessageId} = ANY(${gmailIds})`));
    const idMap = Object.fromEntries(emailRows.map((e) => [e.gmailMessageId, e.threadId]));
    for (const h of hits) if (!h.threadId && idMap[h.gmailMessageId]) h.threadId = idMap[h.gmailMessageId];
  }

  return NextResponse.json({ hits, sources: { vector: vectorResult.status === "fulfilled", fts: ftsResult.status === "fulfilled", corsair: corsairResult.status === "fulfilled" && !(corsairResult.value instanceof CorsairAuthError) } });
}
