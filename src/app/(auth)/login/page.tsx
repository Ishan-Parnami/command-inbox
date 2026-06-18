import { redirect } from "next/navigation";
import { Command } from "lucide-react";
import { auth } from "@/auth";
import { LoginForm } from "@/components/shared/LoginForm";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  const demoLoginEnabled = process.env.DEMO_LOGIN_ENABLED === "true";

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-end p-4">
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-3 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-xl border bg-card">
              <Command className="size-5 text-primary" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">Command Inbox</h1>
              <p className="text-sm text-muted-foreground">
                A keyboard-first AI powered command center for Gmail &amp; Google Calendar.
              </p>
            </div>
          </div>

          <LoginForm showEmailForm={demoLoginEnabled} />

          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            {demoLoginEnabled
              ? "After signing in, connect Gmail and Calendar from the app."
              : "You'll connect Gmail and Calendar in the next step."}
          </p>
        </div>
      </main>
    </div>
  );
}
