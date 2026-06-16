"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { ComposeDraft } from "@/components/compose/ComposeModal";

// Base UI's group label parts require a <Menu.Group> ancestor, so use a plain
// styled heading instead.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 py-1 text-xs font-medium text-muted-foreground">{children}</p>;
}

type DraftRow = {
  id: string;
  threadId: string | null;
  toEmails: string[] | null;
  ccEmails: string[] | null;
  subject: string | null;
  body: string | null;
  scheduledAt: string | null;
  updatedAt: string;
};

function toCompose(d: DraftRow, keepId: boolean): ComposeDraft {
  return {
    id: keepId ? d.id : undefined,
    to: (d.toEmails ?? []).join(", "),
    cc: (d.ccEmails ?? []).join(", "),
    subject: d.subject ?? "",
    body: d.body ?? "",
    threadId: d.threadId ?? undefined,
  };
}

const label = (d: DraftRow) => d.subject?.trim() || d.body?.trim()?.slice(0, 40) || "(no subject)";

export function DraftsMenu({ onOpenDraft }: { onOpenDraft: (draft: ComposeDraft) => void }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["drafts"],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch("/api/drafts");
      if (!res.ok) throw new Error("Failed to load drafts");
      return (await res.json()) as { drafts: DraftRow[]; scheduled: DraftRow[] };
    },
  });

  const drafts = data?.drafts ?? [];
  const scheduled = data?.scheduled ?? [];
  const total = drafts.length + scheduled.length;

  const removeDraft = async (draftId: string) => {
    const res = await fetch("/api/drafts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId }),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error("Failed to delete");
      return;
    }
    toast.success("Deleted");
    queryClient.invalidateQueries({ queryKey: ["drafts"] });
  };

  // Editing a scheduled message cancels the queued send, then reopens it as a draft.
  const openScheduled = async (d: DraftRow) => {
    await removeDraft(d.id);
    onOpenDraft(toCompose(d, false));
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        title="Drafts & scheduled"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "relative")}
      >
        <FileText className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {total === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No drafts</p>
        )}

        {drafts.length > 0 && <SectionLabel>Drafts</SectionLabel>}
        {drafts.map((d) => (
          <DropdownMenuItem
            key={d.id}
            onClick={() => onOpenDraft(toCompose(d, true))}
            className="flex items-center gap-2"
          >
            <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
              <span className="w-full truncate text-sm">{label(d)}</span>
              {(d.toEmails?.length ?? 0) > 0 && (
                <span className="w-full truncate text-xs text-muted-foreground">To: {d.toEmails!.join(", ")}</span>
              )}
            </div>
            <button
              type="button"
              title="Delete draft"
              onClick={(e) => {
                e.stopPropagation();
                void removeDraft(d.id);
              }}
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </DropdownMenuItem>
        ))}

        {scheduled.length > 0 && (
          <>
            {drafts.length > 0 && <div className="my-1 h-px bg-border" />}
            <SectionLabel>Scheduled</SectionLabel>
            {scheduled.map((d) => (
              <DropdownMenuItem
                key={d.id}
                onClick={() => openScheduled(d)}
                className="flex items-center gap-2"
              >
                <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="w-full truncate text-sm">{label(d)}</span>
                  <span className="flex items-center gap-1 text-xs text-primary">
                    <Clock className="size-3" />
                    {d.scheduledAt ? format(new Date(d.scheduledAt), "MMM d, h:mm a") : "scheduled"}
                  </span>
                </div>
                <button
                  type="button"
                  title="Cancel scheduled send"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeDraft(d.id);
                  }}
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
