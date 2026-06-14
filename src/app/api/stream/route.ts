import { auth } from "@/auth";
import { registerSSEController, unregisterSSEController } from "@/lib/sse";

export const dynamic = "force-dynamic";

// Per-user Server-Sent Events channel. Webhooks/polling broadcast onto this so
// the inbox updates without a refresh.
export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;

  let heartbeat: ReturnType<typeof setInterval>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      registerSSEController(userId, controller);
      controller.enqueue(new TextEncoder().encode(": connected\n\n"));
      // Keep proxies from closing the idle connection.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);
    },
    cancel() {
      clearInterval(heartbeat);
      unregisterSSEController(userId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
