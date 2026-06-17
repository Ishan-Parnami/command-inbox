import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Type, type Schema } from "@google/genai";
import { db } from "@/lib/db";
import { emails, llmClassifications } from "@/lib/db/schema";
import { generateJSON, MODELS } from "@/lib/gemini/client";
import { tryConsumeBackgroundClassify } from "@/lib/billing/quota";

// Cheap, high-volume per-email triage with Gemini Flash-Lite → llm_classifications.

const CLASSIFY_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    priority: { type: Type.STRING, enum: ["urgent", "high", "normal", "low"] },
    score: { type: Type.NUMBER },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    summary: { type: Type.STRING },
  },
  required: ["priority", "score", "tags", "summary"],
};

type Classification = {
  priority: "urgent" | "high" | "normal" | "low";
  score: number;
  tags: string[];
  summary: string;
};

type ClassifiableEmail = {
  id: string;
  subject: string | null;
  fromEmail: string | null;
  bodyText: string | null;
  bodySnippet: string | null;
};

function buildPrompt(email: ClassifiableEmail) {
  const body = (email.bodyText ?? email.bodySnippet ?? "").slice(0, 400);
  return `Classify this email. Reply with JSON only.

Subject: ${email.subject ?? "(no subject)"}
From: ${email.fromEmail ?? "(unknown)"}
Body: ${body}

Priority rules:
- urgent: needs action today; deadline, emergency, payment overdue, legal
- high: needs action this week; interview, contract, important project update
- normal: informational, team update, a newsletter you subscribed to
- low: promotional, cold outreach, automated notification

tags (max 3): action-required, finance, travel, meeting, interview, legal, personal, work, automated, newsletter, calendar-invite
score: 0..1 within the tier (1 = top of tier)
summary: one short sentence.`;
}

export async function classifyEmail(userId: string, email: ClassifiableEmail) {
  const allowed = await tryConsumeBackgroundClassify(userId);
  if (!allowed) return false;

  const c = await generateJSON<Classification>(buildPrompt(email), {
    schema: CLASSIFY_SCHEMA,
    model: MODELS.classify,
  });
  await db
    .insert(llmClassifications)
    .values({
      emailId: email.id,
      priority: c.priority,
      priorityScore: c.score,
      tags: c.tags?.slice(0, 3) ?? [],
      summary: c.summary,
      confidence: 0.85,
      modelUsed: MODELS.classify,
    })
    .onConflictDoUpdate({
      target: llmClassifications.emailId,
      set: {
        priority: c.priority,
        priorityScore: c.score,
        tags: c.tags?.slice(0, 3) ?? [],
        summary: c.summary,
        classifiedAt: new Date(),
      },
    });
  return true;
}

/** Classify the user's most recent still-unclassified emails (bounded for cost). */
export async function classifyUnclassified(userId: string, limit = 25): Promise<number> {
  const rows = await db
    .select({
      id: emails.id,
      subject: emails.subject,
      fromEmail: emails.fromEmail,
      bodyText: emails.bodyText,
      bodySnippet: emails.bodySnippet,
    })
    .from(emails)
    .leftJoin(llmClassifications, eq(llmClassifications.emailId, emails.id))
    .where(and(eq(emails.userId, userId), isNull(llmClassifications.id)))
    .orderBy(desc(emails.receivedAt))
    .limit(limit);

  let done = 0;
  for (let i = 0; i < rows.length; i += 5) {
    const batch = rows.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map((e) => classifyEmail(userId, e)));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value === true) done++;
      if (r.status === "fulfilled" && r.value === false) return done;
    }
  }
  return done;
}
