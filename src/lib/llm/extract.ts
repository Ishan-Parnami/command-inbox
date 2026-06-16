import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { Type, type Schema } from "@google/genai";
import { db } from "@/lib/db";
import { emails, llmClassifications, actionItems } from "@/lib/db/schema";
import { generateJSON, MODELS } from "@/lib/gemini/client";
import { broadcastToUser } from "@/lib/sse";

const EXTRACT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING },
          dueDate: { type: Type.STRING, description: "ISO date or null if not specified" },
        },
        required: ["description"],
      },
    },
  },
  required: ["items"],
};

type ExtractResult = {
  items: { description: string; dueDate?: string | null }[];
};

/** Extract action items from a single email body. */
async function extractFromEmail(email: {
  id: string;
  subject: string | null;
  bodyText: string | null;
  bodySnippet: string | null;
}): Promise<{ description: string; dueDate?: string | null }[]> {
  const body = (email.bodyText ?? email.bodySnippet ?? "").slice(0, 600);
  const prompt = `Extract all action items / to-dos from this email. Return JSON only.

Subject: ${email.subject ?? "(no subject)"}
Body: ${body}

If no clear action items, return {"items":[]}.`;

  const result = await generateJSON<ExtractResult>(MODELS.classify, prompt, EXTRACT_SCHEMA);
  return result?.items ?? [];
}

/** Run action-item extraction on urgent+high emails that don't have items yet. */
export async function extractActionItems(userId: string): Promise<void> {
  // Get urgent/high email ids.
  const highPriority = await db
    .select({ emailId: llmClassifications.emailId })
    .from(llmClassifications)
    .where(
      and(
        eq(llmClassifications.userId, userId),
        inArray(llmClassifications.priority, ["urgent", "high"])
      )
    );

  if (!highPriority.length) return;
  const emailIds = highPriority.map((r) => r.emailId!).filter(Boolean);

  // Filter to those without extracted items yet.
  const existing = await db
    .select({ emailId: actionItems.emailId })
    .from(actionItems)
    .where(and(eq(actionItems.userId, userId), inArray(actionItems.emailId, emailIds)));
  const existingIds = new Set(existing.map((r) => r.emailId));
  const toProcess = emailIds.filter((id) => !existingIds.has(id));

  if (!toProcess.length) return;

  const emailRows = await db
    .select({ id: emails.id, threadId: emails.threadId, subject: emails.subject, bodyText: emails.bodyText, bodySnippet: emails.bodySnippet })
    .from(emails)
    .where(and(eq(emails.userId, userId), inArray(emails.id, toProcess)));

  let inserted = 0;
  for (const email of emailRows) {
    try {
      const items = await extractFromEmail(email);
      if (!items.length) continue;
      await db.insert(actionItems).values(
        items.map((item) => ({
          userId,
          emailId: email.id,
          threadId: email.threadId,
          description: item.description,
          dueDate: item.dueDate ? new Date(item.dueDate) : undefined,
        }))
      );
      inserted += items.length;
    } catch {
      // Non-fatal; skip this email
    }
  }

  if (inserted > 0) {
    broadcastToUser(userId, { type: "action_items.updated" });
  }
}
