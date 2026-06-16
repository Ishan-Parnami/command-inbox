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

// ── Tool executor ─────────────────────────────────────────────────────────────
async function runTool(userId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
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
      return listEvents(userId, { timeMin, timeMax, maxResults: 20 });
    }

    case "create_calendar_event": {
      const attendeeList = args.attendees
        ? String(args.attendees).split(",").map((e) => ({ email: e.trim() }))
        : [];
      return createEvent(userId, {
        summary: String(args.title),
        start: { dateTime: String(args.startTime) },
        end: { dateTime: String(args.endTime) },
        description: args.description ? String(args.description) : undefined,
        attendees: attendeeList,
      });
    }

    default:
      return { error: "unknown tool" };
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { message, conversationId } = (await req.json().catch(() => ({}))) as {
    message?: string;
    conversationId?: string;
  };
  if (!message?.trim()) return NextResponse.json({ error: "message required" }, { status: 400 });

  // Load or create conversation row.
  let convo = conversationId
    ? await db.query.agentConversations.findFirst({ where: eq(agentConversations.id, conversationId) })
    : null;
  if (!convo) {
    const [row] = await db.insert(agentConversations).values({ userId, messages: [] }).returning();
    convo = row;
  }

  // Build Gemini contents history.
  const history = (convo.messages ?? []).map((m) => ({
    role: m.role as "user" | "model",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
  }));
  history.push({ role: "user", parts: [{ text: message }] });

  const system = `You are Command Inbox's AI assistant. Today is ${new Date().toDateString()}.
Help the user manage their Gmail inbox and Google Calendar.
When creating calendar events, ALWAYS call list_calendar_events first to check for conflicts.
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
          const res = await ai.models.generateContent({
            model: MODELS.agent,
            contents,
            config: { systemInstruction: system, tools: TOOLS },
          });

          const candidate = res.candidates?.[0];
          const parts = candidate?.content?.parts ?? [];
          const functionCalls = parts.filter((p) => p.functionCall);
          const textParts = parts.filter((p) => p.text);

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
              result = await runTool(userId, fn.name!, (fn.args ?? {}) as Record<string, unknown>);
              actionsTaken.push(fn.name!);
            } catch (e) {
              result = { error: e instanceof CorsairAuthError ? "reconnect required" : String(e) };
            }
            send({ type: "tool_done", tool: fn.name, result });
            toolResults.push({
              role: "user" as const,
              parts: [{ functionResponse: { name: fn.name!, response: result as Record<string, unknown> } }],
            });
          }

          // Append model turn + tool results and loop.
          const modelTurn: Content = candidate!.content!;
          contents = [...contents, modelTurn, ...toolResults];
        }

        send({ type: "done", conversationId: convo!.id });

        // Persist conversation.
        newMessages.push({ role: "assistant", content: fullReply });
        await db
          .update(agentConversations)
          .set({ messages: newMessages, actionsTaken, updatedAt: new Date() })
          .where(eq(agentConversations.id, convo!.id));
      } catch (e) {
        send({ type: "error", message: String(e) });
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
