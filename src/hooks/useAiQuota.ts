"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type AiFeature = "agent" | "search" | "parse" | "brief" | "action_extract";

type FeatureUsage = {
  used: number;
  limit: number;
  remaining: number;
  resetAt: string;
};

type UsageResponse = {
  planId: "free";
  backgroundAiEnabled: boolean;
  backgroundClassify: { used: number; limit: number; remaining: number };
  features: Record<AiFeature, FeatureUsage>;
  warnings: Array<{ feature: AiFeature; level: string; message: string }>;
};

export type QuotaExceededResponse = {
  error: "quota_exceeded";
  feature: AiFeature;
  plan: string;
  limit: number;
  used: number;
  resetAt: string;
  retryAfterSeconds: number;
};

export type QuotaState = {
  used: number;
  limit: number;
  remaining: number;
  isLimited: boolean;
  resetAt: Date | null;
  retryAfterSeconds: number;
  isLoading: boolean;
  refetch: () => void;
};

async function fetchUsage(): Promise<UsageResponse | null> {
  const res = await fetch("/api/usage");
  if (!res.ok) return null;
  return res.json();
}

export function useAiQuota(feature: AiFeature): QuotaState {
  const queryClient = useQueryClient();
  const [cooldown, setCooldown] = useState<{ resetAt: Date; retryAfterSeconds: number } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["usage"],
    queryFn: fetchUsage,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!cooldown) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((cooldown.resetAt.getTime() - Date.now()) / 1000));
      if (remaining <= 0) {
        setCooldown(null);
        refetch();
      } else {
        setCooldown((prev) => (prev ? { ...prev, retryAfterSeconds: remaining } : null));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldown, refetch]);

  const featureUsage = data?.features[feature];
  let isLimited = false;
  let remaining = featureUsage?.remaining ?? 0;
  let resetAt: Date | null = featureUsage?.resetAt ? new Date(featureUsage.resetAt) : null;
  let retryAfterSeconds = 0;

  if (cooldown) {
    isLimited = true;
    remaining = 0;
    resetAt = cooldown.resetAt;
    retryAfterSeconds = cooldown.retryAfterSeconds;
  } else if (featureUsage && featureUsage.remaining <= 0) {
    isLimited = true;
    remaining = 0;
    resetAt = new Date(featureUsage.resetAt);
    retryAfterSeconds = Math.max(0, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
  }

  const handleQuotaExceeded = useCallback(
    (response: QuotaExceededResponse) => {
      setCooldown({
        resetAt: new Date(response.resetAt),
        retryAfterSeconds: response.retryAfterSeconds,
      });
      queryClient.invalidateQueries({ queryKey: ["usage"] });
    },
    [queryClient]
  );

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__setAiQuotaCooldown = handleQuotaExceeded;
    return () => {
      delete (window as unknown as Record<string, unknown>).__setAiQuotaCooldown;
    };
  }, [handleQuotaExceeded]);

  return {
    used: featureUsage?.used ?? 0,
    limit: featureUsage?.limit ?? 0,
    remaining,
    isLimited,
    resetAt,
    retryAfterSeconds,
    isLoading,
    refetch,
  };
}

export function setAiQuotaCooldown(response: QuotaExceededResponse) {
  const handler = (window as unknown as Record<string, unknown>).__setAiQuotaCooldown;
  if (typeof handler === "function") handler(response);
}
