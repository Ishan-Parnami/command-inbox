import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
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

  const result = await generateJSON<ExtractResult>(prompt, { model: MODELS.classify, schema: EXTRACT_SCHEMA });
  return result?.items ?? [];
}

/** Run action-item extraction on urgent+high emails not yet processed for actions. */
export async function extractActionItems(userId: string): Promise<number> {
  const highPriority = await db
    .select({ emailId: llmClassifications.emailId })
    .from(llmClassifications)
    .innerJoin(emails, eq(llmClassifications.emailId, emails.id))
    .where(
      and(
        eq(emails.userId, userId),
        inArray(llmClassifications.priority, ["urgent", "high"]),
        isNull(llmClassifications.actionsExtractedAt)
      )
    );

  if (!highPriority.length) {
    broadcastToUser(userId, { type: "action_items.extract_done", inserted: 0 });
    return 0;
  }

  const emailIds = highPriority.map((r) => r.emailId!).filter(Boolean);

  const emailRows = await db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      bodyText: emails.bodyText,
      bodySnippet: emails.bodySnippet,
    })
    .from(emails)
    .where(and(eq(emails.userId, userId), inArray(emails.id, emailIds)));

  let inserted = 0;
  for (const email of emailRows) {
    try {
      const items = await extractFromEmail(email);

      // Mark email as processed even when Gemini finds no items — prevents re-running
      // on the same email after the user deletes extracted tasks.
      await db
        .update(llmClassifications)
        .set({ actionsExtractedAt: new Date() })
        .where(eq(llmClassifications.emailId, email.id));

      if (!items.length) continue;

      await db.insert(actionItems).values(
        items.map((item) => ({
          userId,
          emailId: email.id,
          threadId: email.threadId,
          description: item.description.trim(),
          dueDate: item.dueDate ? new Date(item.dueDate) : undefined,
        }))
      );
      inserted += items.length;
    } catch {
      // LLM failure — leave actionsExtractedAt null so the next extract can retry.
    }
  }

  if (inserted > 0) {
    broadcastToUser(userId, { type: "action_items.updated" });
  }
  broadcastToUser(userId, { type: "action_items.extract_done", inserted });
  return inserted;
}
