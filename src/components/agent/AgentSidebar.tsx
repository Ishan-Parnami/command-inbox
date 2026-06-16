"use client";

import { useRef, useState } from "react";
import { Bot, Send, X, ChevronDown, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAgentStore } from "@/store/agent.store";

export function AgentSidebar() {
  const { isOpen, isStreaming, messages, conversationId, setOpen, setStreaming, addMessage, updateLastMessage, appendToolCall, resolveToolCall, setConversationId, reset } = useAgentStore();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error("Agent request failed");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "text") {
            updateLastMessage(
              (messages.find((m) => m.id === assistantId)?.content ?? "") + ev.chunk
            );
            scrollToBottom();
          } else if (ev.type === "tool_start") {
            appendToolCall(assistantId, ev.tool);
          } else if (ev.type === "tool_done") {
            resolveToolCall(assistantId, ev.tool, ev.result);
          } else if (ev.type === "done" && ev.conversationId) {
            setConversationId(ev.conversationId);
          }
        }
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

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="size-4 text-primary" />
          AI Assistant
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button variant="ghost" size="icon-sm" title="New conversation" onClick={reset}>
              <ChevronDown className="size-4 rotate-90" />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)}>
            <X className="size-4" />
          </Button>
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
            <div className="space-y-1.5 w-full">
              {[
                "Summarize my unread emails",
                "Schedule a meeting tomorrow at 2pm",
                "Reply to the latest email from my boss",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s); }}
                  className="w-full rounded-md border px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors"
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
                "max-w-[90%] rounded-xl px-3 py-2 text-sm",
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
      <div className="shrink-0 border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Ask anything… (↵ send, ⇧↵ newline)"
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
    </div>
  );
}
