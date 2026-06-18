import { NextResponse } from "next/server";
import { and, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailDrafts, emailThreads } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import { isAuthorizedCron } from "@/lib/cron-auth";

// Map the stored internal thread uuid to the Gmail thread id for threading.
async function gmailThreadId(userId: string, threadId: string | null) {
  if (!threadId) return undefined;
  const [t] = await db
    .select({ gid: emailThreads.gmailThreadId })
    .from(emailThreads)
    .where(and(eq(emailThreads.id, threadId), eq(emailThreads.userId, userId)));
  return t?.gid ?? undefined;
}

// Fires queued "Send Later" drafts that have come due. Trigger from Vercel Cron,
// a Bearer header, or `?token=$CRON_SECRET` (see isAuthorizedCron).
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const due = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.isScheduled, true), lte(emailDrafts.scheduledAt, new Date())));

  let sent = 0;
  for (const d of due) {
    try {
      await sendEmail(d.userId, {
        to: d.toEmails ?? [],
        cc: d.ccEmails ?? [],
        subject: d.subject ?? "",
        body: d.body ?? "",
        gmailThreadId: await gmailThreadId(d.userId, d.threadId),
      });
      await db.delete(emailDrafts).where(eq(emailDrafts.id, d.id));
      sent++;
    } catch {
      // Leave it queued; the next run retries.
    }
  }
  return NextResponse.json({ sent, due: due.length });
}
