import { redirect } from "next/navigation";
import { auth } from "@/auth";

// Server-side guard for every authenticated route. Unauthenticated visitors are
// bounced to /login before any inbox UI renders.
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <>{children}</>;
}
