"use client";

import { useRef, useState } from "react";
import { Bot, Send, X, Wrench, History, Plus, Loader2, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAgentStore, type AgentMessage } from "@/store/agent.store";
import {
  useContactSuggestions,
  applyContactMention,
} from "@/hooks/useContactSuggestions";
import {
  ContactSuggestionList,
  useContactSuggestionKeyboard,
} from "@/components/shared/ContactSuggestionList";
import { AiCooldownBanner } from "@/components/shared/AiCooldownBanner";
import { setAiQuotaCooldown } from "@/hooks/useAiQuota";

type ConversationSummary = { id: string; title: string; count: number; updatedAt: string };

export function AgentSidebar() {
  const { isStreaming, messages, conversationId, setStreaming, addMessage, updateLastMessage, appendToolCall, resolveToolCall, setConversationId, loadConversation, reset } = useAgentStore();
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const contactSuggestions = useContactSuggestions(input);
  const pickContact = (contact: { email: string; name: string | null }) =>
    setInput(applyContactMention(input, contact));
  const contactKb = useContactSuggestionKeyboard(
    contactSuggestions.suggestions,
    pickContact,
    inputFocused && contactSuggestions.suggestions.length > 0
  );
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/agent/conversations");
      const data = await res.json();
      setHistory(data.conversations ?? []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openConversation = async (id: string) => {
    try {
      const res = await fetch(`/api/agent/conversations/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { id: string; messages: Array<{ role: string; content: unknown }> };
      const msgs: AgentMessage[] = (data.messages ?? []).map((m) => ({
        id: crypto.randomUUID(),
        role: m.role === "assistant" ? "assistant" : "user",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));
      loadConversation(data.id, msgs);
      scrollToBottom();
    } catch {
      // ignore — keep current conversation
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/agent/conversations/${deleteTarget.id}`, { method: "DELETE" });
      setHistory((h) => h.filter((c) => c.id !== deleteTarget.id));
      if (deleteTarget.id === conversationId) reset();
    } catch {
      // ignore — leave history as-is
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const scrollToBottom = () => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

  const send = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");

    const userMsgId = crypto.randomUUID();
    addMessage({ id: userMsgId, role: "user", content: text });
    scrollToBottom();

    const assistantId = crypto.randomUUID();
    addMessage({ id: assistantId, role: "assistant", content: "" });
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const reqPayload = {
      message: text,
      conversationId,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqPayload),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => "");
        if (res.status === 429) {
          try {
            const quotaError = JSON.parse(errBody);
            if (quotaError.error === "quota_exceeded") {
              setAiQuotaCooldown(quotaError);
              updateLastMessage(
                "You've reached your daily AI assistant limit. Please try again later."
              );
              setStreaming(false);
              return;
            }
          } catch {
            // ignore
          }
        }
        throw new Error(`Agent request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let assistantText = "";
      let errored = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (ev.type === "text") {
            assistantText += ev.chunk;
            updateLastMessage(assistantText);
            scrollToBottom();
          } else if (ev.type === "tool_start") {
            appendToolCall(assistantId, ev.tool as string);
          } else if (ev.type === "tool_done") {
            resolveToolCall(assistantId, ev.tool as string, ev.result);
          } else if (ev.type === "error") {
            errored = true;
            assistantText = "Sorry, something went wrong handling that. Please try again.";
            updateLastMessage(assistantText);
          } else if (ev.type === "done" && ev.conversationId) {
            setConversationId(ev.conversationId as string);
          }
        }
      }

      // Guarantee a non-empty bubble even if the stream sent no text.
      if (!errored && !assistantText.trim()) {
        updateLastMessage("Done. Let me know if you need anything else.");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        updateLastMessage("Sorry, something went wrong. Please try again.");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      scrollToBottom();
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="size-4 text-primary" />
          AI Assistant
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu onOpenChange={(o) => o && loadHistory()}>
            <DropdownMenuTrigger
              title="Chat history"
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              )}
            >
              <History className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
              <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">Chat history</div>
              {historyLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : history.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">No past conversations.</p>
              ) : (
                history.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() => openConversation(c.id)}
                    className={cn("flex items-center gap-2", c.id === conversationId && "bg-muted")}
                  >
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                      <span className="line-clamp-1 text-sm">{c.title}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {c.count} messages · {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}
                      </span>
                    </div>
                    <button
                      type="button"
                      title="Delete conversation"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(c);
                      }}
                      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {messages.length > 0 && (
            <Button variant="ghost" size="icon-sm" title="New conversation" onClick={reset}>
              <Plus className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center text-muted-foreground">
            <Bot className="size-8 opacity-30" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Ask me anything</p>
              <p className="text-xs">Search emails, create events,<br />draft replies, and more.</p>
            </div>
            <div className="space-y-1.5 w-1/2 md:w-1/3">
              {[
                "Summarize my unread emails",
                "Schedule a meeting tomorrow at 2pm",
                "Reply to the latest email from my boss",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInput(s);
                    setTimeout(() => inputRef.current?.focus(), 0);
                  }}
                  className="w-full text-center rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={cn("flex flex-col gap-1", m.role === "user" && "items-end")}>
            <div
              className={cn(
                "max-w-[50%] w-fit rounded-xl px-3 py-2 text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              )}
            >
              {m.content || (m.role === "assistant" && isStreaming ? <span className="animate-pulse">●●●</span> : null)}
            </div>

            {/* Tool call badges */}
            {m.toolCalls && m.toolCalls.length > 0 && (
              <div className="flex flex-wrap gap-1 max-w-[90%]">
                {m.toolCalls.map((tc, i) => (
                  <span
                    key={i}
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                      tc.status === "running"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    )}
                  >
                    <Wrench className="size-2.5" />
                    {tc.tool.replace(/_/g, " ")}
                    {tc.status === "running" && <span className="animate-spin">⟳</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t p-3 space-y-2">
        <AiCooldownBanner feature="agent" />
        <div className="relative flex items-end gap-2">
          {inputFocused && contactSuggestions.suggestions.length > 0 && (
            <ContactSuggestionList
              suggestions={contactSuggestions.suggestions}
              highlightIndex={contactKb.highlightIndex}
              onPick={pickContact}
              position="above"
            />
          )}
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => {
              if (contactKb.handleKeyDown(e)) return;
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Ask anything… type @ for contacts (↵ send, ⇧↵ newline)"
            className="min-h-[60px] resize-none text-sm"
            disabled={isStreaming}
          />
          <Button
            size="icon"
            onClick={isStreaming ? () => { abortRef.current?.abort(); setStreaming(false); } : send}
            disabled={!isStreaming && !input.trim()}
            title={isStreaming ? "Stop" : "Send"}
          >
            {isStreaming ? <X className="size-4" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription className="line-clamp-2">
              “{deleteTarget?.title}” will be permanently removed. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
