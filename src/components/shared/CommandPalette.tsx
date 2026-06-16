"use client";

import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";

export type PaletteCommand = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
};

export type PaletteGroup = { heading: string; items: PaletteCommand[] };

// Static reference shown at the bottom — keys that aren't selectable commands.
const NAV_HINTS: { keys: string; label: string }[] = [
  { keys: "J / K", label: "Next / previous email" },
  { keys: "⌘ F", label: "AI search emails" },
  { keys: "⌘ K", label: "Open command palette" },
  { keys: "? or ⌘ K", label: "Keyboard shortcuts" },
];

export function CommandPalette({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: PaletteGroup[];
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No commands.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g.heading} heading={g.heading}>
            {g.items.map((c) => (
              <CommandItem
                key={c.id}
                disabled={c.disabled}
                onSelect={() => {
                  onOpenChange(false);
                  c.onSelect();
                }}
              >
                {c.icon}
                <span>{c.label}</span>
                {c.shortcut && <CommandShortcut>{c.shortcut}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandGroup heading="Navigation">
          {NAV_HINTS.map((h) => (
            <div key={h.keys} className="flex items-center justify-between px-2 py-1.5 text-sm text-muted-foreground">
              <span>{h.label}</span>
              <CommandShortcut>{h.keys}</CommandShortcut>
            </div>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
