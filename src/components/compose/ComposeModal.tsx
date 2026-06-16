"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  applyContactToken,
  type Contact,
} from "@/hooks/useContactSuggestions";

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const splitEmails = (s: string) =>
  s.split(",").map((e) => e.trim()).filter(Boolean);

function ContactSuggestions({
  suggestions,
  onPick,
}: {
  suggestions: Contact[];
  onPick: (email: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <ul className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-48 overflow-auto rounded-md border bg-popover py-1 shadow-md">
      {suggestions.map((c) => (
        <li key={c.email}>
          <button
            type="button"
            // onMouseDown fires before the input's blur, so the pick lands.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(c.email);
            }}
            className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-accent"
          >
            <span className="font-medium">{c.name || c.email}</span>
            {c.name && <span className="text-xs text-muted-foreground">{c.email}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

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

  // Saved contacts power alias resolution: typing a contact's name (or first
  // name) in To/Cc auto-resolves to their email so it passes validation.
  const { data: contactsData } = useQuery<{ contacts: { email: string; name: string | null }[] }>({
    queryKey: ["contacts"],
    queryFn: () => fetch("/api/contacts").then((r) => r.json()),
    staleTime: 60_000,
  });

  const aliasMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contactsData?.contacts ?? []) {
      if (!c.name) continue;
      const full = c.name.trim().toLowerCase();
      if (full && !m.has(full)) m.set(full, c.email);
      const first = full.split(/\s+/)[0];
      if (first && !m.has(first)) m.set(first, c.email);
    }
    return m;
  }, [contactsData]);

  const resolveAlias = (token: string) =>
    EMAIL_RE.test(token) ? token : aliasMap.get(token.toLowerCase()) ?? token;

  const rawTo = splitEmails(to);
  const rawCc = splitEmails(cc);
  const toList = rawTo.map(resolveAlias);
  const ccList = rawCc.map(resolveAlias);
  const resolvedAlias = [...rawTo, ...rawCc].some((t) => !EMAIL_RE.test(t) && EMAIL_RE.test(resolveAlias(t)));
  const badEmails = [...toList, ...ccList].filter((e) => !EMAIL_RE.test(e));
  const canSend =
    (toList.length > 0 || !!draft.threadId) && !!body.trim() && badEmails.length === 0;

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
              placeholder="To"
              className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
            {!showCc && (
              <button
                onClick={() => setShowCc(true)}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                Cc
              </button>
            )}
            {focused === "to" && (
              <ContactSuggestions
                suggestions={toSuggestions.suggestions}
                onPick={(email) => setTo(applyContactToken(to, email))}
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
                placeholder="Cc"
                className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
              {focused === "cc" && (
                <ContactSuggestions
                  suggestions={ccSuggestions.suggestions}
                  onPick={(email) => setCc(applyContactToken(cc, email))}
                />
              )}
            </div>
          )}
          <div className="border-b px-4 py-1.5">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
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

        {resolvedAlias && badEmails.length === 0 && (
          <p className="border-t px-4 py-1.5 text-xs text-muted-foreground">
            Sending to: {toList.join(", ")}
            {ccList.length > 0 && ` · cc ${ccList.join(", ")}`}
          </p>
        )}

        {badEmails.length > 0 && (
          <p className="border-t px-4 py-1.5 text-xs text-destructive">
            Invalid email or unknown contact: {badEmails.join(", ")}
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
