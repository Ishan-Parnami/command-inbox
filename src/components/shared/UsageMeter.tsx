"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Sparkles } from "lucide-react";

type FeatureUsage = {
  used: number;
  limit: number;
  remaining: number;
  resetAt: string;
};

type UsageResponse = {
  planId: "free";
  quotaEnforced?: boolean;
  features: Record<string, FeatureUsage>;
};

async function fetchUsage(): Promise<UsageResponse | null> {
  const res = await fetch("/api/usage");
  if (!res.ok) return null;
  return res.json();
}

export function UsageMeter() {
  const { data, isLoading } = useQuery({
    queryKey: ["usage"],
    queryFn: fetchUsage,
    staleTime: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div className="px-2 py-1.5">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (data.quotaEnforced === false) {
    return (
      <div className="flex items-start gap-1.5 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>AI limits off — set Upstash Redis in env</span>
      </div>
    );
  }

  const agentUsage = data.features.agent;
  const usagePercent =
    agentUsage.limit > 0 ? Math.min(100, Math.round((agentUsage.used / agentUsage.limit) * 100)) : 0;
  const isNearLimit = usagePercent >= 80;

  return (
    <div className="space-y-2 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" />
          <span className="font-medium">Free</span>
        </div>
        <span className={isNearLimit ? "text-amber-500" : "text-muted-foreground"}>
          {agentUsage.used}/{agentUsage.limit} AI today
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${isNearLimit ? "bg-amber-500" : "bg-primary"}`}
          style={{ width: `${usagePercent}%` }}
        />
      </div>
    </div>
  );
}
