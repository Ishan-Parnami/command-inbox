"use client";

import { create } from "zustand";

type InboxTab = "all" | "urgent" | "high" | "action";

interface InboxStore {
  selectedThreadId: string | null;
  focusedIndex: number;
  activeTab: InboxTab;
  composeOpen: boolean;
  searchOpen: boolean;
  shortcutsOpen: boolean;

  setSelectedThread: (id: string | null) => void;
  setFocusedIndex: (index: number) => void;
  setActiveTab: (tab: InboxTab) => void;
  setComposeOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
}

export const useInboxStore = create<InboxStore>((set) => ({
  selectedThreadId: null,
  focusedIndex: 0,
  activeTab: "all",
  composeOpen: false,
  searchOpen: false,
  shortcutsOpen: false,

  setSelectedThread: (id) => set({ selectedThreadId: id }),
  setFocusedIndex: (index) => set({ focusedIndex: index }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setComposeOpen: (open) => set({ composeOpen: open }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
}));
