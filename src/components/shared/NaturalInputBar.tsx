"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  useContactSuggestions,
  applyContactMention,
} from "@/hooks/useContactSuggestions";
import {
  ContactSuggestionList,
  useContactSuggestionKeyboard,
} from "@/components/shared/ContactSuggestionList";

export type ParseResult = {
  intent: "email" | "event";
  email?: { to?: string; subject?: string; body?: string };
  event?: {
    title?: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    attendees?: string;
  };
};

export function NaturalInputBar({
  open,
  onOpenChange,
  onResult,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (result: ParseResult) => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  const contactSuggestions = useContactSuggestions(text);
  const pickContact = (contact: { email: string; name: string | null }) =>
    setText(applyContactMention(text, contact));
  const contactKb = useContactSuggestionKeyboard(
    contactSuggestions.suggestions,
    pickContact,
    focused && contactSuggestions.suggestions.length > 0
  );

  useEffect(() => {
    if (open) setText("");
  }, [open]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    console.log("[parse:client] submit:", trimmed);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      console.log("[parse:client] response status:", res.status);
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error("[parse:client] failed:", { status: res.status, body: errBody });
        throw new Error("parse failed");
      }
      const result = (await res.json()) as ParseResult;
      console.log("[parse:client] result:", result);
      onResult(result);
      setText("");
      onOpenChange(false);
    } catch (e) {
      console.error("[parse:client] error:", e);
      toast.error("Couldn't understand that — try rephrasing.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Natural compose
          </DialogTitle>
          <DialogDescription>
            Describe an email or event in plain English. Type <kbd className="rounded border px-1">@</kbd> for
            contacts. e.g. &ldquo;Email @Sara about the launch&rdquo; or &ldquo;Lunch with @John tomorrow 1pm&rdquo;.
          </DialogDescription>
        </DialogHeader>
        <div className="relative flex items-center gap-2">
          {focused && contactSuggestions.suggestions.length > 0 && (
            <ContactSuggestionList
              suggestions={contactSuggestions.suggestions}
              highlightIndex={contactKb.highlightIndex}
              onPick={pickContact}
              position="above"
            />
          )}
          <Input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (contactKb.handleKeyDown(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="What do you want to do?"
            disabled={loading}
          />
          <Button onClick={() => void submit()} disabled={loading || !text.trim()}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Go"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
