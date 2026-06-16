import { NextResponse } from "next/server";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { emails, emailVectors, emailThreads } from "@/lib/db/schema";
import { embed } from "@/lib/gemini/client";
import { searchCachedMessages } from "@/lib/corsair/client";
import { parseSearchQuery } from "@/lib/search/query";

type Hit = {
  gmailMessageId: string;
  threadId: string | null;
  gmailThreadId: string | null;
  subject: string | null;
  snippet: string | null;
  fromName: string | null;
  fromEmail: string | null;
  receivedAt: string | null;
  source: "vector" | "fts" | "corsair";
  score: number;
};

function mapCorsairRow(m: Record<string, unknown>): Hit | null {
  const id = typeof m.id === "string" ? m.id : null;
  if (!id) return null;

  if (typeof m.subject === "string" || typeof m.from === "string") {
    const fromRaw = typeof m.from === "string" ? m.from : null;
    return {
      gmailMessageId: id,
      threadId: null,
      gmailThreadId: typeof m.threadId === "string" ? m.threadId : null,
      subject: typeof m.subject === "string" ? m.subject : null,
      snippet:
        typeof m.snippet === "string"
          ? m.snippet
          : typeof m.body === "string"
            ? m.body.slice(0, 200)
            : null,
      fromName: null,
      fromEmail: fromRaw,
      receivedAt:
        typeof m.internalDate === "string"
          ? new Date(Number(m.internalDate)).toISOString()
          : null,
      source: "corsair",
      score: 0.5,
    };
  }

  const payload = m.payload as { headers?: Array<{ name: string; value: string }> } | undefined;
  const headers = payload?.headers ?? [];
  const sub = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? null;
  const from = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? null;
  return {
    gmailMessageId: id,
    threadId: null,
    gmailThreadId: typeof m.threadId === "string" ? m.threadId : null,
    subject: sub,
    snippet: typeof m.snippet === "string" ? m.snippet : null,
    fromName: null,
    fromEmail: from,
    receivedAt: null,
    source: "corsair",
    score: 0.5,
  };
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ hits: [] });

  const parsed = parseSearchQuery(q);

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
        gmailThreadId: null,
        subject: e.subject,
        snippet: e.bodySnippet,
        fromName: e.fromName,
        fromEmail: e.fromEmail,
        receivedAt: e.receivedAt?.toISOString() ?? null,
        source: "vector" as const,
        score: simMap[e.id] ?? 0,
      }));
    })(),

    // Mode 2: Full-text + sender match on local DB
    (async (): Promise<Hit[]> => {
      const hits: Hit[] = [];

      if (parsed.from) {
        const pattern = `%${parsed.from}%`;
        const senderRows = await db
          .select()
          .from(emails)
          .where(
            and(
              eq(emails.userId, userId),
              or(ilike(emails.fromEmail, pattern), ilike(emails.fromName, pattern))
            )
          )
          .orderBy(sql`${emails.receivedAt} desc nulls last`)
          .limit(10);

        hits.push(
          ...senderRows.map((e) => ({
            gmailMessageId: e.gmailMessageId,
            threadId: e.threadId,
            gmailThreadId: null,
            subject: e.subject,
            snippet: e.bodySnippet,
            fromName: e.fromName,
            fromEmail: e.fromEmail,
            receivedAt: e.receivedAt?.toISOString() ?? null,
            source: "fts" as const,
            score: 1,
          }))
        );
      }

      const ftsQuery = parsed.text || (!parsed.from ? q : "");
      if (ftsQuery) {
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
              to_tsvector('english', coalesce(${emails.subject}, '') || ' ' || coalesce(${emails.bodySnippet}, '') || ' ' || coalesce(${emails.fromName}, '') || ' ' || coalesce(${emails.fromEmail}, '')),
              plainto_tsquery('english', ${ftsQuery})
            )`,
          })
          .from(emails)
          .where(
            and(
              eq(emails.userId, userId),
              sql`to_tsvector('english', coalesce(${emails.subject}, '') || ' ' || coalesce(${emails.bodySnippet}, '') || ' ' || coalesce(${emails.fromName}, '') || ' ' || coalesce(${emails.fromEmail}, '')) @@ plainto_tsquery('english', ${ftsQuery})`
            )
          )
          .orderBy(sql`rank desc`)
          .limit(10);

        hits.push(
          ...rows.map((e) => ({
            gmailMessageId: e.gmailMessageId,
            threadId: e.threadId,
            gmailThreadId: null,
            subject: e.subject,
            snippet: e.snippet,
            fromName: e.fromName,
            fromEmail: e.fromEmail,
            receivedAt: e.receivedAt?.toISOString() ?? null,
            source: "fts" as const,
            score: e.rank,
          }))
        );
      }

      return hits;
    })(),

    // Mode 3: Corsair-cached Gmail search
    (async (): Promise<Hit[]> => {
      const rows = await searchCachedMessages(userId, q, 10);
      return rows.map(mapCorsairRow).filter((h): h is Hit => h !== null);
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

  // Resolve internal thread UUID (emails.thread_id), not Gmail's thread id string.
  const gmailIds = hits.map((h) => h.gmailMessageId);
  if (gmailIds.length) {
    const emailRows = await db
      .select({ gmailMessageId: emails.gmailMessageId, threadId: emails.threadId })
      .from(emails)
      .where(and(eq(emails.userId, userId), inArray(emails.gmailMessageId, gmailIds)));
    const idMap = Object.fromEntries(emailRows.map((e) => [e.gmailMessageId, e.threadId]));
    for (const h of hits) if (idMap[h.gmailMessageId]) h.threadId = idMap[h.gmailMessageId];
  }

  const unresolvedGmailThreadIds = [
    ...new Set(hits.filter((h) => !h.threadId && h.gmailThreadId).map((h) => h.gmailThreadId!)),
  ];
  if (unresolvedGmailThreadIds.length) {
    const threadRows = await db
      .select({ id: emailThreads.id, gmailThreadId: emailThreads.gmailThreadId })
      .from(emailThreads)
      .where(and(eq(emailThreads.userId, userId), inArray(emailThreads.gmailThreadId, unresolvedGmailThreadIds)));
    const threadMap = Object.fromEntries(threadRows.map((t) => [t.gmailThreadId, t.id]));
    for (const h of hits) {
      if (!h.threadId && h.gmailThreadId && threadMap[h.gmailThreadId]) {
        h.threadId = threadMap[h.gmailThreadId];
      }
    }
  }

  const publicHits = hits.map(({ gmailThreadId: _g, score: _s, ...h }) => h);

  return NextResponse.json({
    hits: publicHits,
    sources: {
      vector: vectorResult.status === "fulfilled",
      fts: ftsResult.status === "fulfilled",
      corsair: corsairResult.status === "fulfilled",
    },
  });
}
