"use client";

import { create } from "zustand";

export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ tool: string; status: "running" | "done"; result?: unknown }>;
};

interface AgentStore {
  isOpen: boolean;
  isStreaming: boolean;
  messages: AgentMessage[];
  conversationId: string | null;

  setOpen: (open: boolean) => void;
  setStreaming: (streaming: boolean) => void;
  addMessage: (message: AgentMessage) => void;
  updateLastMessage: (content: string) => void;
  appendToolCall: (msgId: string, tool: string) => void;
  resolveToolCall: (msgId: string, tool: string, result: unknown) => void;
  setConversationId: (id: string) => void;
  loadConversation: (id: string, messages: AgentMessage[]) => void;
  reset: () => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  isOpen: false,
  isStreaming: false,
  messages: [],
  conversationId: null,

  setOpen: (open) => set({ isOpen: open }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  updateLastMessage: (content) =>
    set((s) => {
      const messages = [...s.messages];
      if (messages.length > 0) messages[messages.length - 1].content = content;
      return { messages };
    }),
  appendToolCall: (msgId, tool) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId
          ? { ...m, toolCalls: [...(m.toolCalls ?? []), { tool, status: "running" as const }] }
          : m
      ),
    })),
  resolveToolCall: (msgId, tool, result) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId
          ? {
              ...m,
              toolCalls: (m.toolCalls ?? []).map((tc) =>
                tc.tool === tool ? { ...tc, status: "done" as const, result } : tc
              ),
            }
          : m
      ),
    })),
  setConversationId: (id) => set({ conversationId: id }),
  loadConversation: (id, messages) => set({ conversationId: id, messages, isStreaming: false }),
  reset: () => set({ messages: [], conversationId: null, isStreaming: false }),
}));
