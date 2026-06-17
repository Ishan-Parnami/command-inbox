"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, Sparkles, X, Trash2, Plus } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type ActionItem = {
  id: string;
  description: string;
  dueDate: string | null;
  isDone: boolean;
  createdAt: string;
};

const EXTRACT_KEY = "action-extract-pending";
const EXTRACT_TTL_MS = 120_000;

function isExtractPending(): boolean {
  if (typeof window === "undefined") return false;
  const t = sessionStorage.getItem(EXTRACT_KEY);
  if (!t) return false;
  if (Date.now() - Number(t) > EXTRACT_TTL_MS) {
    sessionStorage.removeItem(EXTRACT_KEY);
    return false;
  }
  return true;
}

export function ActionBoard({ onClose }: { onClose?: () => void }) {
  const [extracting, setExtracting] = useState(isExtractPending);
  const [addOpen, setAddOpen] = useState(false);
  const [newDescription, setNewDescription] = useState("");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ items: ActionItem[] }>({
    queryKey: ["action-items"],
    queryFn: () => fetch("/api/action-items").then((r) => r.json()),
    staleTime: 30_000,
    refetchInterval: extracting ? 4_000 : false,
    refetchOnWindowFocus: true,
  });

  // Stop extracting when background job completes (SSE) or times out.
  useEffect(() => {
    if (!extracting) return;
    const onDone = () => {
      setExtracting(false);
      sessionStorage.removeItem(EXTRACT_KEY);
    };
    window.addEventListener("action-items-extract-done", onDone);
    const stop = setTimeout(onDone, EXTRACT_TTL_MS);
    return () => {
      window.removeEventListener("action-items-extract-done", onDone);
      clearTimeout(stop);
    };
  }, [extracting]);

  const toggleDone = useMutation({
    mutationFn: ({ id, isDone }: { id: string; isDone: boolean }) =>
      fetch("/api/action-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isDone }),
      }),
    onMutate: async ({ id, isDone }) => {
      await qc.cancelQueries({ queryKey: ["action-items"] });
      const prev = qc.getQueryData<{ items: ActionItem[] }>(["action-items"]);
      qc.setQueryData<{ items: ActionItem[] }>(["action-items"], (old) => ({
        items: (old?.items ?? []).map((item) => (item.id === id ? { ...item, isDone } : item)),
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(["action-items"], ctx?.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["action-items"] }),
  });

  const createItem = useMutation({
    mutationFn: (description: string) =>
      fetch("/api/action-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      }).then(async (r) => {
        if (!r.ok) throw new Error("create failed");
        return r.json() as Promise<{ item: ActionItem }>;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action-items"] });
      setAddOpen(false);
      setNewDescription("");
      toast.success("Action added");
    },
    onError: () => toast.error("Failed to add action"),
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/action-items?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["action-items"] }),
    onError: () => toast.error("Failed to delete item"),
  });

  const [deleteTarget, setDeleteTarget] = useState<ActionItem | null>(null);

  const extract = async () => {
    setExtracting(true);
    sessionStorage.setItem(EXTRACT_KEY, String(Date.now()));
    try {
      const res = await fetch("/api/action-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extract: true }),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.message ?? "Daily extraction limit reached");
        setExtracting(false);
        sessionStorage.removeItem(EXTRACT_KEY);
        return;
      }
      if (!res.ok) throw new Error("extract failed");
      toast.success("Extracting actions in the background…");
    } catch {
      toast.error("Extraction failed to start");
      setExtracting(false);
      sessionStorage.removeItem(EXTRACT_KEY);
    }
  };

  const items = data?.items ?? [];

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CheckCircle2 className="size-4 text-primary" />
          Action Board
          {extracting && (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Extracting…
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Add action"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Extract from emails"
            onClick={extract}
            disabled={extracting}
          >
            {extracting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-muted-foreground">
            <CheckCircle2 className="size-8 opacity-30" />
            <div className="space-y-1">
              <p className="text-sm font-medium">No action items</p>
              <p className="text-xs">
                Add one manually, or click ✦ to extract to-dos from urgent emails.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="size-3.5" />
                Add action
              </Button>
              <Button size="sm" variant="outline" onClick={extract} disabled={extracting}>
                <Sparkles className="size-3.5" />
                Extract
              </Button>
            </div>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                <button
                  className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-primary"
                  onClick={() => toggleDone.mutate({ id: item.id, isDone: !item.isDone })}
                  title={item.isDone ? "Mark incomplete" : "Mark done"}
                >
                  {item.isDone ? (
                    <CheckCircle2 className="size-4 text-primary" />
                  ) : (
                    <Circle className="size-4" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm leading-snug",
                      item.isDone && "text-muted-foreground line-through"
                    )}
                  >
                    {item.description}
                  </p>
                  {item.dueDate && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Due {format(new Date(item.dueDate), "MMM d")}
                    </p>
                  )}
                </div>
                <button
                  className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                  title="Delete item"
                  onClick={() => setDeleteTarget(item)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {items.length > 0 && (
        <div className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
          {items.filter((i) => !i.isDone).length} remaining · {items.filter((i) => i.isDone).length} done
        </div>
      )}

      {/* Add action */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add action</DialogTitle>
            <DialogDescription>Track a to-do that isn&apos;t from an email.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="What needs to be done?"
            value={newDescription}
            autoFocus
            onChange={(e) => setNewDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newDescription.trim()) {
                createItem.mutate(newDescription.trim());
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newDescription.trim() || createItem.isPending}
              onClick={() => createItem.mutate(newDescription.trim())}
            >
              {createItem.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete action item?</DialogTitle>
            <DialogDescription className="line-clamp-3">
              “{deleteTarget?.description}” will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteItem.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteItem.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                deleteItem.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
