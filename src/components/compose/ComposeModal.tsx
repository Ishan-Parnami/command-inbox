"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Clock, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  useContactSuggestions,
  applyContactMention,
  parseRecipientField,
  hasUnresolvedRecipients,
  type Contact,
} from "@/hooks/useContactSuggestions";
import {
  ContactSuggestionList,
  useContactSuggestionKeyboard,
} from "@/components/shared/ContactSuggestionList";

export type ComposeDraft = {
  id?: string; // existing draft row being restored/edited
  to: string;
  cc: string;
  subject: string;
  body: string;
  threadId?: string; // internal thread uuid when replying
};

export type SendPayload = {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  threadId?: string;
  draftId?: string;
  scheduledAt?: string;
};

const SCHEDULE_PRESETS: { label: string; at: () => Date }[] = [
  { label: "In 1 hour", at: () => new Date(Date.now() + 60 * 60_000) },
  { label: "In 3 hours", at: () => new Date(Date.now() + 180 * 60_000) },
  {
    label: "Tomorrow, 9 AM",
    at: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
];

// Remounted via `key` on each open, so useState seeds straight from `draft`.
export function ComposeModal({
  open,
  draft,
  onOpenChange,
  onSend,
}: {
  open: boolean;
  draft: ComposeDraft;
  onOpenChange: (open: boolean) => void;
  onSend: (payload: SendPayload) => void;
}) {
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [showCc, setShowCc] = useState(!!draft.cc);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [draftId, setDraftId] = useState<string | null>(draft.id ?? null);
  const [focused, setFocused] = useState<"to" | "cc" | null>(null);

  const toSuggestions = useContactSuggestions(to);
  const ccSuggestions = useContactSuggestions(cc);
  const pickTo = (c: Contact) => setTo(applyContactMention(to, c, ", "));
  const pickCc = (c: Contact) => setCc(applyContactMention(cc, c, ", "));
  const toKb = useContactSuggestionKeyboard(
    toSuggestions.suggestions,
    pickTo,
    focused === "to" && toSuggestions.suggestions.length > 0
  );
  const ccKb = useContactSuggestionKeyboard(
    ccSuggestions.suggestions,
    pickCc,
    focused === "cc" && ccSuggestions.suggestions.length > 0
  );

  const toList = parseRecipientField(to);
  const ccList = parseRecipientField(cc);
  const unresolved = hasUnresolvedRecipients(to) || hasUnresolvedRecipients(cc);
  const canSend =
    (toList.length > 0 || !!draft.threadId) && !!body.trim() && !unresolved;

  // Debounced autosave to /api/drafts; keeps the draft id for subsequent updates.
  useEffect(() => {
    if (!open) return;
    if (!to && !cc && !subject && !body) return;
    const id = setTimeout(async () => {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, threadId: draft.threadId, to: toList, cc: ccList, subject, body }),
      }).catch(() => null);
      if (res?.ok) setDraftId((await res.json()).id);
    }, 800);
    return () => clearTimeout(id);
  }, [open, to, cc, subject, body]); // eslint-disable-line react-hooks/exhaustive-deps

  const discardDraft = () => {
    if (!draftId) return;
    fetch("/api/drafts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId }),
    }).catch(() => null);
    setDraftId(null);
  };

  const hand = (scheduledAt?: string) => {
    onSend({ to: toList, cc: ccList, subject, body, threadId: draft.threadId, draftId: draftId ?? undefined, scheduledAt });
    // The send route discards the draft once it actually goes out.
    setDraftId(null);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">
            {draft.threadId ? "Reply" : "New message"}
          </SheetTitle>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex items-center gap-2 border-b px-4 py-1.5">
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onFocus={() => setFocused("to")}
              onBlur={() => setFocused((f) => (f === "to" ? null : f))}
              onKeyDown={(e) => {
                if (toKb.handleKeyDown(e)) return;
              }}
              placeholder="To — type @ for contacts"
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            {!showCc && (
              <button
                onClick={() => setShowCc(true)}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                Cc
              </button>
            )}
            {focused === "to" && toSuggestions.suggestions.length > 0 && (
              <ContactSuggestionList
                suggestions={toSuggestions.suggestions}
                highlightIndex={toKb.highlightIndex}
                onPick={pickTo}
              />
            )}
          </div>
          {showCc && (
            <div className="relative border-b px-4 py-1.5">
              <Input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                onFocus={() => setFocused("cc")}
                onBlur={() => setFocused((f) => (f === "cc" ? null : f))}
                onKeyDown={(e) => {
                  if (ccKb.handleKeyDown(e)) return;
                }}
                placeholder="Cc — type @ for contacts"
                className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
              {focused === "cc" && ccSuggestions.suggestions.length > 0 && (
                <ContactSuggestionList
                  suggestions={ccSuggestions.suggestions}
                  highlightIndex={ccKb.highlightIndex}
                  onPick={pickCc}
                />
              )}
            </div>
          )}
          <div className="border-b px-4 py-1.5">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </div>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSend) hand();
            }}
            placeholder="Write your message…  (⌘↵ to send)"
            className="min-h-0 flex-1 resize-none rounded-none border-0 px-4 py-3 shadow-none focus-visible:ring-0"
          />
        </div>

        {unresolved && (
          <p className="border-t px-4 py-1.5 text-xs text-destructive">
            Finish contact names with @ or use a full email address.
          </p>
        )}

        <SheetFooter className="flex-row items-center gap-1.5 border-t px-4 py-3">
          <div className="flex items-center">
            <Button disabled={!canSend} onClick={() => hand()} className="rounded-r-none">
              <Send className="size-4" />
              Send
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={!canSend}
                className={cn(buttonVariants({ size: "icon" }), "rounded-l-none border-l border-primary-foreground/20")}
                title="Send later"
              >
                <ChevronDown className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {SCHEDULE_PRESETS.map((p) => (
                  <DropdownMenuItem key={p.label} onClick={() => hand(p.at().toISOString())}>
                    <Clock className="size-4" />
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              // Empty compose leaves nothing behind; otherwise it stays in Drafts.
              if (!to && !cc && !subject && !body) discardDraft();
              onOpenChange(false);
            }}
          >
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
