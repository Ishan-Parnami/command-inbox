"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Loader2, Sparkles, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ActionItem = {
  id: string;
  description: string;
  dueDate: string | null;
  isDone: boolean;
  createdAt: string;
};

export function ActionBoard({ onClose }: { onClose: () => void }) {
  const [extracting, setExtracting] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ items: ActionItem[] }>({
    queryKey: ["action-items"],
    queryFn: () => fetch("/api/action-items").then((r) => r.json()),
    staleTime: 30_000,
  });

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
        items: (old?.items ?? []).map((item) => item.id === id ? { ...item, isDone } : item),
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(["action-items"], ctx?.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["action-items"] }),
  });

  const extract = async () => {
    setExtracting(true);
    try {
      await fetch("/api/action-items", { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["action-items"] });
      toast.success("Extracted new action items");
    } catch {
      toast.error("Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  const items = data?.items ?? [];

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CheckCircle2 className="size-4 text-primary" />
          Action Board
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Extract from emails"
            onClick={extract}
            disabled={extracting}
          >
            {extracting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
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
              <p className="text-xs">Click ✦ to extract to-dos from your urgent emails.</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                <button
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary transition-colors"
                  onClick={() => toggleDone.mutate({ id: item.id, isDone: !item.isDone })}
                >
                  {item.isDone ? (
                    <CheckCircle2 className="size-4 text-primary" />
                  ) : (
                    <Circle className="size-4" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm leading-snug", item.isDone && "line-through text-muted-foreground")}>
                    {item.description}
                  </p>
                  {item.dueDate && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Due {format(new Date(item.dueDate), "MMM d")}
                    </p>
                  )}
                </div>
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
    </div>
  );
}
