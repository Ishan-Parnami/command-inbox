import { redirect } from "next/navigation";
import { Command } from "lucide-react";
import { auth } from "@/auth";
import { GoogleSignInButton } from "@/components/shared/GoogleSignInButton";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { LoginForm } from "@/components/shared/LoginForm";

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

          {demoLoginEnabled ? (
            <div className="space-y-6">
              <div className="rounded-xl border bg-card p-5 shadow-sm">
                <div className="mb-5 space-y-1">
                  <h2 className="text-sm font-semibold tracking-tight">Email sign-in</h2>
                </div>
                <LoginForm />
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-wide">
                  <span className="bg-background px-3 text-muted-foreground">or</span>
                </div>
              </div>
              <GoogleSignInButton />
            </div>
          ) : (
            <GoogleSignInButton />
          )}

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
