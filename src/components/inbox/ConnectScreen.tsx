"use client";

import { Mail, Calendar, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = { gmailConnected: boolean; calendarConnected: boolean };

function StatusRow({
  icon,
  label,
  connected,
}: {
  icon: React.ReactNode;
  label: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <Check className={cn("size-4", connected ? "text-primary" : "text-muted-foreground/40")} />
        {connected ? "Connected" : "Pending"}
      </span>
    </div>
  );
}

export function ConnectScreen({ gmailConnected, calendarConnected }: Props) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1.5 text-center">
          <h2 className="text-lg font-semibold tracking-tight">Connect your account</h2>
          <p className="text-sm text-muted-foreground">
            Command Inbox reads your Gmail &amp; Calendar through Corsair. One sign-in connects both.
          </p>
        </div>
        <div className="space-y-2.5">
          <StatusRow icon={<Mail className="size-4" />} label="Gmail" connected={gmailConnected} />
          <StatusRow
            icon={<Calendar className="size-4" />}
            label="Google Calendar"
            connected={calendarConnected}
          />
        </div>
        {/* Starts the Gmail consent; the callback chains into Calendar automatically. */}
        <a
          className={cn(buttonVariants({ size: "lg" }), "w-full")}
          href="/api/corsair/connect?provider=gmail"
        >
          Connect Google
        </a>
      </div>
    </div>
  );
}
