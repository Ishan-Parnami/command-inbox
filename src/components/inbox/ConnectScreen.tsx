"use client";

import { Mail, Calendar, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = { gmailConnected: boolean; calendarConnected: boolean };

function ConnectRow({
  icon,
  label,
  provider,
  connected,
}: {
  icon: React.ReactNode;
  label: string;
  provider: string;
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
      {connected ? (
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          <Check className="size-4 text-primary" />
          Connected
        </span>
      ) : (
        <a className={cn(buttonVariants({ size: "sm" }))} href={`/api/corsair/connect?provider=${provider}`}>
          Connect
        </a>
      )}
    </div>
  );
}

export function ConnectScreen({ gmailConnected, calendarConnected }: Props) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1.5 text-center">
          <h2 className="text-lg font-semibold tracking-tight">Connect your accounts</h2>
          <p className="text-sm text-muted-foreground">
            Command Inbox reads your Gmail &amp; Calendar through Corsair. Connect Gmail to get
            started.
          </p>
        </div>
        <div className="space-y-2.5">
          <ConnectRow
            icon={<Mail className="size-4" />}
            label="Gmail"
            provider="gmail"
            connected={gmailConnected}
          />
          <ConnectRow
            icon={<Calendar className="size-4" />}
            label="Google Calendar"
            provider="googlecalendar"
            connected={calendarConnected}
          />
        </div>
      </div>
    </div>
  );
}
