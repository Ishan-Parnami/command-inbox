import { NextResponse } from "next/server";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { emails, emailVectors, emailThreads } from "@/lib/db/schema";
import { embed } from "@/lib/gemini/client";
import { searchCachedMessages, pickGmailApiMessageId, pickGmailThreadId } from "@/lib/corsair/client";
import { parseSearchQuery } from "@/lib/search/query";
import { enforceAiQuota, QuotaExceededError } from "@/lib/billing/quota";

type Hit = {
  gmailMessageId: string;
  cacheMessageId: string | null;
  cacheRow: Record<string, unknown> | null;
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

function normalizeSubject(subject: string | null | undefined): string | null {
  const s = subject?.trim();
  if (!s) return null;
  if (s.toLowerCase() === "(no subject)") return null;
  return s;
}

function emailFtsVector() {
  return sql`to_tsvector('english',
    coalesce(${emails.subject}, '') || ' ' ||
    coalesce(${emails.bodySnippet}, '') || ' ' ||
    coalesce(left(${emails.bodyText}, 2000), '') || ' ' ||
    coalesce(${emails.fromName}, '') || ' ' ||
    coalesce(${emails.fromEmail}, '')
  )`;
}

function ilikePattern(phrase: string) {
  return `%${phrase}%`;
}

function mapEmailRow(
  e: {
    gmailMessageId: string;
    threadId: string | null;
    subject: string | null;
    snippet?: string | null;
    bodySnippet?: string | null;
    fromName: string | null;
    fromEmail: string | null;
    receivedAt: Date | null;
  },
  score: number
): Hit {
  return {
    gmailMessageId: e.gmailMessageId,
    cacheMessageId: null,
    cacheRow: null,
    threadId: e.threadId,
    gmailThreadId: null,
    subject: normalizeSubject(e.subject),
    snippet: truncatePreview(e.snippet ?? e.bodySnippet ?? null, 200),
    fromName: e.fromName,
    fromEmail: e.fromEmail,
    receivedAt: e.receivedAt?.toISOString() ?? null,
    source: "fts",
    score,
  };
}

function truncatePreview(text: string | null | undefined, max = 140): string | null {
  if (!text?.trim()) return null;
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

// Coerce a value (string, or common nested shapes like {email,name}/{value}) to text.
function valueToText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return (
      valueToText(o.value) ??
      valueToText(o.text) ??
      valueToText(o.email) ??
      valueToText(o.address) ??
      valueToText(o.name) ??
      null
    );
  }
  return null;
}

// Find the first string value under a key matching `keyRe`, scanning nested objects.
function findByKey(value: unknown, keyRe: RegExp, depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 3) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findByKey(item, keyRe, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const row = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(row)) {
    if (keyRe.test(k)) {
      const t = valueToText(v);
      if (t) return t;
    }
  }
  for (const v of Object.values(row)) {
    if (v && typeof v === "object") {
      const found = findByKey(v, keyRe, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// Look up an RFC822 header value from a Gmail-native `headers`/`payload.headers` array.
function findHeader(value: unknown, name: string, depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 3) return null;
  const row = value as Record<string, unknown>;
  const payload = row.payload as { headers?: unknown } | undefined;
  const headerArrays = [row.headers, payload?.headers];
  for (const headers of headerArrays) {
    if (Array.isArray(headers)) {
      const h = headers.find(
        (x) =>
          x && typeof x === "object" &&
          typeof (x as { name?: unknown }).name === "string" &&
          ((x as { name: string }).name).toLowerCase() === name.toLowerCase()
      );
      const val = valueToText((h as { value?: unknown } | undefined)?.value);
      if (val) return val;
    }
  }
  for (const v of Object.values(row)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const found = findHeader(v, name, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractCorsairFields(m: Record<string, unknown>) {
  const subject = findByKey(m, /^(subject|title)$/i) ?? findHeader(m, "Subject");
  const from =
    findByKey(m, /^(from|sender)$|from.?email|from.?name|from.?address/i) ?? findHeader(m, "From");
  const body =
    findByKey(m, /^(body|snippet|text|content|preview)$|body.?text|body.?snippet|text.?body|plain.?text/i);
  return { subject, from, body };
}

function corsairCacheRow(
  m: Record<string, unknown>,
  cacheId: string,
  gmailThreadId: string | null,
  fields: { subject: string | null; from: string | null; body: string | null }
) {
  return {
    id: cacheId,
    threadId: gmailThreadId,
    subject: fields.subject,
    from: fields.from,
    body: fields.body,
    snippet: fields.body,
    internalDate: m.internalDate ?? null,
  };
}

function mapCorsairRow(m: Record<string, unknown>): Hit | null {
  const cacheId = typeof m.id === "string" ? m.id : pickGmailApiMessageId(m);
  if (!cacheId) return null;

  const gmailApiId = pickGmailApiMessageId(m);
  const gmailThreadId = pickGmailThreadId(m);

  const fields = extractCorsairFields(m);

  // Skip un-openable / empty hits so we never render a bare "Message" row.
  if (!fields.subject && !fields.from && !fields.body) return null;

  const internalDate = m.internalDate;
  return {
    gmailMessageId: gmailApiId ?? cacheId,
    cacheMessageId: gmailApiId && gmailApiId !== cacheId ? cacheId : gmailApiId ? null : cacheId,
    cacheRow: corsairCacheRow(m, cacheId, gmailThreadId, fields),
    threadId: null,
    gmailThreadId,
    subject: normalizeSubject(fields.subject),
    snippet: truncatePreview(fields.body, 200),
    fromName: null,
    fromEmail: fields.from,
    receivedAt:
      typeof internalDate === "string" || typeof internalDate === "number"
        ? new Date(Number(internalDate)).toISOString()
        : null,
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
  const query = q;

  const parsed = parseSearchQuery(query);

  async function runVectorSearch(): Promise<Hit[]> {
    try {
      await enforceAiQuota(userId, "search");
    } catch (e) {
      if (e instanceof QuotaExceededError) return [];
      throw e;
    }
    const vec = await embed(query, "RETRIEVAL_QUERY");
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
      cacheMessageId: null,
      cacheRow: null,
      threadId: e.threadId,
      gmailThreadId: null,
      subject: normalizeSubject(e.subject),
      snippet: truncatePreview(e.bodySnippet, 200),
      fromName: e.fromName,
      fromEmail: e.fromEmail,
      receivedAt: e.receivedAt?.toISOString() ?? null,
      source: "vector" as const,
      score: simMap[e.id] ?? 0,
    }));
  }

  const [vectorResult, ftsResult, corsairResult] = await Promise.allSettled([
    runVectorSearch(),

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
            cacheMessageId: null,
            cacheRow: null,
            threadId: e.threadId,
            gmailThreadId: null,
            subject: normalizeSubject(e.subject),
            snippet: truncatePreview(e.bodySnippet, 200),
            fromName: e.fromName,
            fromEmail: e.fromEmail,
            receivedAt: e.receivedAt?.toISOString() ?? null,
            source: "fts" as const,
            score: 1,
          }))
        );
      }

      const ftsQuery = parsed.text || (!parsed.from ? query : "");
      if (ftsQuery) {
        const ftsVec = emailFtsVector();
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
              ${ftsVec},
              websearch_to_tsquery('english', ${ftsQuery})
            )`,
          })
          .from(emails)
          .where(
            and(
              eq(emails.userId, userId),
              sql`${ftsVec} @@ websearch_to_tsquery('english', ${ftsQuery})`
            )
          )
          .orderBy(sql`rank desc`)
          .limit(10);

        hits.push(
          ...rows.map((e) => mapEmailRow({ ...e, bodySnippet: e.snippet }, e.rank))
        );

        // Substring fallback when FTS misses (filler words, punctuation, short phrases).
        if (hits.length === 0 && ftsQuery.length >= 3) {
          const pattern = ilikePattern(ftsQuery);
          const ilikeRows = await db
            .select({
              gmailMessageId: emails.gmailMessageId,
              threadId: emails.threadId,
              subject: emails.subject,
              bodySnippet: emails.bodySnippet,
              fromName: emails.fromName,
              fromEmail: emails.fromEmail,
              receivedAt: emails.receivedAt,
            })
            .from(emails)
            .where(
              and(
                eq(emails.userId, userId),
                or(
                  ilike(emails.subject, pattern),
                  ilike(emails.bodySnippet, pattern),
                  ilike(emails.bodyText, pattern),
                  ilike(emails.fromName, pattern),
                  ilike(emails.fromEmail, pattern)
                )
              )
            )
            .orderBy(desc(emails.receivedAt))
            .limit(10);

          hits.push(...ilikeRows.map((e) => mapEmailRow(e, 0.8)));

          if (ilikeRows.length === 0) {
            const threadRows = await db
              .select({
                threadId: emailThreads.id,
                gmailThreadId: emailThreads.gmailThreadId,
                subject: emailThreads.subject,
                snippet: emailThreads.snippet,
                lastMessageAt: emailThreads.lastMessageAt,
              })
              .from(emailThreads)
              .where(
                and(
                  eq(emailThreads.userId, userId),
                  eq(emailThreads.isTrashed, false),
                  or(ilike(emailThreads.subject, pattern), ilike(emailThreads.snippet, pattern))
                )
              )
              .orderBy(desc(emailThreads.lastMessageAt))
              .limit(10);

            for (const t of threadRows) {
              const [latest] = await db
                .select({
                  gmailMessageId: emails.gmailMessageId,
                  fromName: emails.fromName,
                  fromEmail: emails.fromEmail,
                  receivedAt: emails.receivedAt,
                })
                .from(emails)
                .where(eq(emails.threadId, t.threadId))
                .orderBy(desc(emails.receivedAt))
                .limit(1);

              if (!latest) continue;

              hits.push({
                gmailMessageId: latest.gmailMessageId,
                cacheMessageId: null,
                cacheRow: null,
                threadId: t.threadId,
                gmailThreadId: t.gmailThreadId,
                subject: normalizeSubject(t.subject),
                snippet: truncatePreview(t.snippet, 200),
                fromName: latest.fromName,
                fromEmail: latest.fromEmail,
                receivedAt: (latest.receivedAt ?? t.lastMessageAt)?.toISOString() ?? null,
                source: "fts",
                score: 0.7,
              });
            }
          }
        }
      }

      return hits;
    })(),

    // Mode 3: Corsair-cached Gmail search (uses normalized text from parseSearchQuery)
    (async (): Promise<Hit[]> => {
      const rows = await searchCachedMessages(userId, parsed.text || query, 10);
      return rows.map(mapCorsairRow).filter((h): h is Hit => h !== null);
    })(),
  ]);

  // Merge — deduplicate by message id, prefer higher source priority.
  const merged = new Map<string, Hit>();
  const priority = { vector: 3, fts: 2, corsair: 1 };

  for (const result of [vectorResult, ftsResult, corsairResult]) {
    if (result.status !== "fulfilled") continue;
    for (const hit of result.value) {
      const key = hit.cacheMessageId ?? hit.gmailMessageId;
      const existing = merged.get(key);
      if (!existing || priority[hit.source] > priority[existing.source]) {
        merged.set(key, hit);
      }
    }
  }

  const hits = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 20);

  // Resolve internal thread UUID (emails.thread_id), not Gmail's thread id string.
  const gmailIds = [
    ...new Set(hits.flatMap((h) => [h.gmailMessageId, h.cacheMessageId].filter(Boolean) as string[])),
  ];
  if (gmailIds.length) {
    const emailRows = await db
      .select({ gmailMessageId: emails.gmailMessageId, threadId: emails.threadId })
      .from(emails)
      .where(and(eq(emails.userId, userId), inArray(emails.gmailMessageId, gmailIds)));
    const idMap = Object.fromEntries(emailRows.map((e) => [e.gmailMessageId, e.threadId]));
    for (const h of hits) {
      if (idMap[h.gmailMessageId]) h.threadId = idMap[h.gmailMessageId];
      else if (h.cacheMessageId && idMap[h.cacheMessageId]) h.threadId = idMap[h.cacheMessageId];
    }
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

  const publicHits = hits.map(({ score: _s, ...h }) => h);

  return NextResponse.json({
    hits: publicHits,
    sources: {
      vector: vectorResult.status === "fulfilled",
      fts: ftsResult.status === "fulfilled",
      corsair: corsairResult.status === "fulfilled",
    },
  });
}
