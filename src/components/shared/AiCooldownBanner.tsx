"use client";

import { Clock } from "lucide-react";
import { useAiQuota } from "@/hooks/useAiQuota";
import type { AiFeature } from "@/hooks/useAiQuota";

type Props = {
  feature: AiFeature;
  className?: string;
};

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

const FEATURE_NAMES: Record<AiFeature, string> = {
  agent: "AI Assistant",
  search: "AI Search",
  parse: "Natural Compose",
  brief: "Meeting Brief",
  action_extract: "Action Items",
};

export function AiCooldownBanner({ feature, className = "" }: Props) {
  const quota = useAiQuota(feature);

  if (!quota.isLimited) return null;

  const featureName = FEATURE_NAMES[feature];
  const timeLeft = formatTime(quota.retryAfterSeconds);

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm ${className}`}
    >
      <Clock className="size-4 shrink-0 text-amber-500" />
      <div className="flex-1">
        <span className="text-muted-foreground">
          You&apos;ve used all {quota.limit} {featureName.toLowerCase()} requests today.
        </span>
        <span className="ml-1 font-medium text-amber-500">Try again in {timeLeft}.</span>
      </div>
    </div>
  );
}
