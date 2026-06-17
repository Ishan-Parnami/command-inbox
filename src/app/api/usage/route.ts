import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUsageSummary } from "@/lib/billing/quota";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const usage = await getUsageSummary(session.user.id);
  return NextResponse.json(usage);
}
