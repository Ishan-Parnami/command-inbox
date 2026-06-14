"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function SyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function sync() {
    setLoading(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (data.signInLink) {
          window.location.href = data.signInLink;
          return;
        }
        throw new Error(data.error ?? "Sync failed");
      }
      toast.success(`Synced ${data.emails ?? 0} emails · ${data.events ?? 0} events`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={sync} disabled={loading}>
      <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
      Sync
    </Button>
  );
}
