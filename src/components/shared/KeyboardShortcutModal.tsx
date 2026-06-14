"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "J / K", label: "Next / previous email" },
  { keys: "E", label: "Archive" },
  { keys: "S", label: "Star / unstar" },
  { keys: "U", label: "Mark read / unread" },
  { keys: "H", label: "Snooze (1 hour)" },
  { keys: "#", label: "Move to trash" },
  { keys: "⌘ K", label: "Command palette" },
  { keys: "?", label: "This help" },
];

export function KeyboardShortcutModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{s.label}</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
