"server-only";

const controllers = new Map<string, ReadableStreamDefaultController<Uint8Array>>();

export function broadcastToUser(userId: string, event: Record<string, unknown>): void {
  const ctrl = controllers.get(userId);
  if (!ctrl) return;
  try {
    ctrl.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  } catch {
    controllers.delete(userId);
  }
}

export function registerSSEController(
  userId: string,
  ctrl: ReadableStreamDefaultController<Uint8Array>
): void {
  controllers.set(userId, ctrl);
}

export function unregisterSSEController(userId: string): void {
  controllers.delete(userId);
}
