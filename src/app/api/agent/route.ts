import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { GoogleGenAI, Type, type Tool, type Content } from "@google/genai";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { agentConversations } from "@/lib/db/schema";
import { MODELS } from "@/lib/gemini/client";
import {
  sendMessage,
  archiveMessage,
  getThread,
  searchCachedMessages,
  listEvents,
  createEvent,
  CorsairAuthError,
} from "@/lib/corsair/client";
import { gmailAddress } from "@/lib/email/send";
import { buildRawMessage } from "@/lib/email/mime";
import { contactDirectory } from "@/lib/contacts";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "search_emails",
        description: "Search the user's Gmail inbox for emails matching a query.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: { type: Type.STRING, description: "Gmail search query" },
          },
          required: ["query"],
        },
      },
      {
        name: "get_email_thread",
        description: "Get the full messages in a Gmail thread by thread ID.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            threadId: { type: Type.STRING, description: "Gmail thread id (starts with a number)" },
          },
          required: ["threadId"],
        },
      },
      {
        name: "send_email",
        description: "Send an email.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            to: { type: Type.STRING, description: "Recipient email address" },
            subject: { type: Type.STRING, description: "Email subject" },
            body: { type: Type.STRING, description: "Plain text body" },
          },
          required: ["to", "subject", "body"],
        },
      },
      {
        name: "archive_email",
        description: "Archive an email by Gmail message id.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            messageId: { type: Type.STRING, description: "Gmail message id" },
          },
          required: ["messageId"],
        },
      },
      {
        name: "list_calendar_events",
        description: "List the user's upcoming calendar events. Always call this before creating an event to check for conflicts.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            days: { type: Type.NUMBER, description: "Number of days ahead to look (default 7)" },
          },
        },
      },
      {
        name: "create_calendar_event",
        description: "Create a calendar event. Always call list_calendar_events first to check for conflicts.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            startTime: { type: Type.STRING, description: "ISO 8601 datetime" },
            endTime: { type: Type.STRING, description: "ISO 8601 datetime" },
            description: { type: Type.STRING },
            attendees: { type: Type.STRING, description: "Comma-separated email addresses" },
          },
          required: ["title", "startTime", "endTime"],
        },
      },
    ],
  },
];

function logError(tag: string, e: unknown) {
  if (e instanceof Error) {
    console.error(tag, { message: e.message, stack: e.stack, name: e.name });
  } else {
    console.error(tag, e);
  }
}

// ── Tool executor ─────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Google Calendar expects a local datetime + IANA timezone. Strip any Z/offset
// Gemini may append so "5pm" stays 17:00 local, not 17:00 UTC (10:30pm IST).
function toLocalDateTime(iso: string) {
  return iso.replace(/Z$/i, "").replace(/[+-]\d{2}:\d{2}$/, "");
}

async function runTool(
  userId: string,
  name: string,
  args: Record<string, unknown>,
  timeZone: string
): Promise<unknown> {
  console.log(`[agent:tool] ${name} called`, { userId, args: JSON.stringify(args) });
  switch (name) {
    case "search_emails":
      return searchCachedMessages(userId, String(args.query), 10);

    case "get_email_thread":
      return getThread(userId, String(args.threadId));

    case "send_email": {
      const from = await gmailAddress(userId);
      const raw = buildRawMessage({
        from,
        to: [String(args.to)],
        subject: String(args.subject),
        body: String(args.body),
      });
      return sendMessage(userId, raw);
    }

    case "archive_email":
      return archiveMessage(userId, String(args.messageId));

    case "list_calendar_events": {
      const days = Number(args.days ?? 7);
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + days * 86_400_000).toISOString();
      console.log("[agent:tool] list_calendar_events range:", { timeMin, timeMax, days });
      const events = await listEvents(userId, { timeMin, timeMax, maxResults: 20 });
      console.log("[agent:tool] list_calendar_events result count:", Array.isArray(events) ? events.length : events);
      return events;
    }

    case "create_calendar_event": {
      const attendeeList = args.attendees
        ? String(args.attendees)
            .split(",")
            .map((e) => e.trim())
            .filter((e) => EMAIL_RE.test(e))
            .map((e) => ({ email: e }))
        : [];
      const startLocal = toLocalDateTime(String(args.startTime));
      const endLocal = toLocalDateTime(String(args.endTime));
      const payload = {
        summary: String(args.title),
        start: { dateTime: startLocal, timeZone },
        end: { dateTime: endLocal, timeZone },
        description: args.description ? String(args.description) : undefined,
        attendees: attendeeList,
      };
      console.log("[agent:tool] create_calendar_event payload:", JSON.stringify(payload));
      try {
        const result = await createEvent(userId, payload);
        console.log("[agent:tool] create_calendar_event success:", JSON.stringify(result));
        return { success: true, event: result };
      } catch (e) {
        logError("[agent:tool] create_calendar_event failed:", e);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }

    default:
      console.warn("[agent:tool] unknown tool:", name);
      return { error: "unknown tool" };
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { message, conversationId, timeZone: clientTz } = (await req.json().catch(() => ({}))) as {
    message?: string;
    conversationId?: string;
    timeZone?: string;
  };
  if (!message?.trim()) return NextResponse.json({ error: "message required" }, { status: 400 });

  const timeZone =
    clientTz && /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(clientTz) ? clientTz : "UTC";

  console.log("[agent] POST", { userId, conversationId, message: message.trim() });

  // Load or create conversation row — non-fatal if DB is slow.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ConvoShape = { id: string; messages: any[] | null; actionsTaken: string[] | null };
  let convo: ConvoShape = { id: crypto.randomUUID(), messages: [], actionsTaken: [] };
  try {
    const existing = conversationId
      ? (await db.query.agentConversations.findFirst({ where: eq(agentConversations.id, conversationId) }) ?? null)
      : null;
    if (existing) {
      convo = existing;
      console.log("[agent] loaded conversation:", convo.id, "messages:", convo.messages?.length ?? 0);
    } else {
      const [row] = await db.insert(agentConversations).values({ userId, messages: [] }).returning();
      convo = row;
      console.log("[agent] created conversation:", convo.id);
    }
  } catch (dbErr) {
    console.warn("[agent] DB unavailable — ephemeral session:", dbErr);
    // DB unavailable — proceed without persistence (ephemeral session)
  }

  // Build Gemini contents history.
  const history = ((convo.messages ?? []) as Array<{ role: string; content: unknown }>).map((m) => ({
    role: m.role === "assistant" || m.role === "model" ? ("model" as const) : ("user" as const),
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
  }));
  history.push({ role: "user", parts: [{ text: message }] });

  const directory = await contactDirectory(userId);
  const system = `You are Command Inbox's AI assistant. Today is ${new Date().toDateString()}.
Help the user manage their Gmail inbox and Google Calendar.

User timezone: ${timeZone}. All times the user mentions (e.g. "5pm", "tomorrow at 2") are in this timezone unless they explicitly say otherwise.

Scheduling rules:
- When creating calendar events, call list_calendar_events first to check for conflicts, then call create_calendar_event in the SAME turn flow — do not stop after only checking.
- Ask for a missing required detail (title, date, or time) with ONE short question. As soon as the user provides it, immediately call create_calendar_event — do not just acknowledge or re-ask.
- Infer sensible defaults: if no duration is given, make the event 1 hour; interpret relative times against today in the user's timezone.
- For create_calendar_event startTime/endTime, pass local datetimes WITHOUT "Z" or UTC offset (e.g. "2026-06-16T17:00:00" for 5pm local). The server attaches the user's timezone.
- After a tool succeeds, always write a one-line confirmation of what you did. Never reply with an empty message.
${directory ? `\nKnown contacts (resolve any name the user mentions to their email for "to"/attendees):\n${directory}` : ""}

Be concise. When you take an action, confirm what you did.`;

  // Streaming response with function-calling loop (max 8 turns).
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      const actionsTaken: string[] = [...(convo!.actionsTaken ?? [])];
      const newMessages = [...(convo!.messages ?? []), { role: "user" as const, content: message }];
      let fullReply = "";

      try {
        let contents: Content[] = history;

        for (let turn = 0; turn < 8; turn++) {
          console.log(`[agent] turn ${turn + 1}/8 — calling Gemini, contents length:`, contents.length);
          let res;
          try {
            res = await ai.models.generateContent({
              model: MODELS.agent,
              contents,
              config: { systemInstruction: system, tools: TOOLS },
            });
          } catch (geminiErr) {
            logError(`[agent] turn ${turn + 1} Gemini generateContent failed:`, geminiErr);
            throw geminiErr;
          }

          const candidate = res.candidates?.[0];
          const parts = candidate?.content?.parts ?? [];
          const functionCalls = parts.filter((p) => p.functionCall);
          const textParts = parts.filter((p) => p.text);
          console.log(`[agent] turn ${turn + 1} response:`, {
            textParts: textParts.map((p) => p.text),
            functionCalls: functionCalls.map((p) => ({
              name: p.functionCall?.name,
              args: p.functionCall?.args,
            })),
            finishReason: candidate?.finishReason,
          });

          // Stream any text.
          for (const p of textParts) {
            fullReply += p.text ?? "";
            send({ type: "text", chunk: p.text ?? "" });
          }

          if (!functionCalls.length) break;

          // Execute tools and send status events.
          const toolResults = [];
          for (const p of functionCalls) {
            const fn = p.functionCall!;
            send({ type: "tool_start", tool: fn.name });
            let result: unknown;
            try {
              result = await runTool(userId, fn.name!, (fn.args ?? {}) as Record<string, unknown>, timeZone);
              actionsTaken.push(fn.name!);
            } catch (e) {
              logError(`[agent] tool ${fn.name} threw:`, e);
              result = { error: e instanceof CorsairAuthError ? "reconnect required" : String(e) };
            }
            console.log(`[agent] tool ${fn.name} result:`, JSON.stringify(result)?.slice(0, 2000));
            send({ type: "tool_done", tool: fn.name, result });
            // Gemini requires functionResponse.response to be a JSON object.
            // Arrays/primitives (e.g. search results) must be wrapped or the
            // next generateContent call throws ("something went wrong").
            const response: Record<string, unknown> =
              result && typeof result === "object" && !Array.isArray(result)
                ? (result as Record<string, unknown>)
                : { result };
            toolResults.push({
              role: "user" as const,
              parts: [{ functionResponse: { name: fn.name!, response } }],
            });
          }

          // Append model turn + tool results and loop.
          const modelTurn: Content = candidate!.content!;
          contents = [...contents, modelTurn, ...toolResults];
        }

        // Never finish with an empty assistant message — synthesize a fallback.
        if (!fullReply.trim()) {
          const didActions = actionsTaken.length > (convo!.actionsTaken?.length ?? 0);
          fullReply = didActions
            ? "Done — I've completed that for you."
            : "I couldn't complete that just now. Could you rephrase or add a bit more detail?";
          send({ type: "text", chunk: fullReply });
        }

        console.log("[agent] stream done:", { conversationId: convo!.id, fullReplyLength: fullReply.length, actionsTaken });
        send({ type: "done", conversationId: convo!.id });

        // Persist conversation (non-fatal).
        newMessages.push({ role: "assistant", content: fullReply });
        db.update(agentConversations)
          .set({ messages: newMessages, actionsTaken, updatedAt: new Date() })
          .where(eq(agentConversations.id, convo!.id))
          .catch((persistErr) => console.warn("[agent] persist failed:", persistErr));
      } catch (e) {
        logError("[agent] stream error:", e);
        send({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
