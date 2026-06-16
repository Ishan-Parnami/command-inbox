import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const rows = await db
      .select()
      .from(contacts)
      .where(eq(contacts.userId, session.user.id))
      .orderBy(desc(contacts.emailCount));
    return NextResponse.json({ contacts: rows });
  } catch {
    return NextResponse.json({ contacts: [] });
  }
}

// POST /api/contacts — add a custom contact
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { email, name } = (await req.json().catch(() => ({}))) as { email?: string; name?: string };
  const cleanEmail = email?.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@"))
    return NextResponse.json({ error: "valid email required" }, { status: 400 });

  const [row] = await db
    .insert(contacts)
    .values({
      userId: session.user.id,
      email: cleanEmail,
      name: name?.trim() || null,
      emailCount: 0,
    })
    .onConflictDoUpdate({
      target: [contacts.userId, contacts.email],
      set: { name: name?.trim() || null },
    })
    .returning();

  return NextResponse.json({ contact: row });
}

// PATCH /api/contacts — edit name and/or VIP status
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, isVip, name } = (await req.json().catch(() => ({}))) as {
    id?: string;
    isVip?: boolean;
    name?: string;
  };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (isVip === undefined && name === undefined)
    return NextResponse.json({ error: "isVip or name required" }, { status: 400 });

  const set: { isVip?: boolean; name?: string | null } = {};
  if (isVip !== undefined) set.isVip = isVip;
  if (name !== undefined) set.name = name.trim() || null;

  await db
    .update(contacts)
    .set(set)
    .where(and(eq(contacts.id, id), eq(contacts.userId, session.user.id)));

  return NextResponse.json({ ok: true });
}

// DELETE /api/contacts?id=... — remove a contact
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await db.delete(contacts).where(and(eq(contacts.id, id), eq(contacts.userId, session.user.id)));
  return NextResponse.json({ ok: true });
}
