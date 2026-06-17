import "server-only";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import {
  FREE_BURST_PER_MINUTE,
  FREE_DAILY_LIMITS,
  getBackgroundClassifyDailyLimit,
  type AiFeature,
  type UserFacingFeature,
} from "./plans";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redis;
}

/** True when Upstash Redis is configured — quotas are enforced only then. */
export function isQuotaEnforced(): boolean {
  return !!getRedis();
}

const burstLimiters = new Map<UserFacingFeature, Ratelimit>();

function getBurstLimiter(feature: UserFacingFeature): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  let limiter = burstLimiters.get(feature);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(FREE_BURST_PER_MINUTE[feature], "60 s"),
      analytics: false,
      prefix: "rl",
    });
    burstLimiters.set(feature, limiter);
  }
  return limiter;
}

function dailyKey(userId: string, feature: string): string {
  const today = new Date().toISOString().split("T")[0];
  return `quota:${userId}:${feature}:daily:${today}`;
}

function midnightUtc(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export class QuotaExceededError extends Error {
  constructor(
    public feature: AiFeature,
    public limit: number,
    public used: number,
    public resetAt: Date,
    public retryAfterSeconds: number
  ) {
    super(`Quota exceeded for ${feature}`);
    this.name = "QuotaExceededError";
  }

  toJSON() {
    return {
      error: "quota_exceeded" as const,
      feature: this.feature,
      plan: "free" as const,
      limit: this.limit,
      used: this.used,
      resetAt: this.resetAt.toISOString(),
      retryAfterSeconds: this.retryAfterSeconds,
    };
  }
}

export type QuotaResult = {
  allowed: true;
  feature: UserFacingFeature;
  used: number;
  limit: number;
  remaining: number;
  resetAt: Date;
};

export async function enforceAiQuota(userId: string, feature: UserFacingFeature): Promise<QuotaResult> {
  const limit = FREE_DAILY_LIMITS[feature];
  const resetAt = midnightUtc();
  const r = getRedis();

  if (!r) {
    console.warn("[quota] Redis not configured — allowing request");
    return { allowed: true, feature, used: 0, limit, remaining: limit, resetAt };
  }

  const burstLimiter = getBurstLimiter(feature);
  if (burstLimiter) {
    const burst = await burstLimiter.limit(`${userId}:${feature}`);
    if (!burst.success) {
      const retryAfterSeconds = Math.ceil((burst.reset - Date.now()) / 1000);
      throw new QuotaExceededError(
        feature,
        FREE_BURST_PER_MINUTE[feature],
        FREE_BURST_PER_MINUTE[feature],
        new Date(burst.reset),
        retryAfterSeconds
      );
    }
  }

  const key = dailyKey(userId, feature);
  const current = (await r.get<number>(key)) ?? 0;
  if (current >= limit) {
    const retryAfterSeconds = Math.max(0, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
    throw new QuotaExceededError(feature, limit, current, resetAt, retryAfterSeconds);
  }

  const used = await r.incr(key);
  if (used === 1) await r.expire(key, 48 * 60 * 60);

  return {
    allowed: true,
    feature,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt,
  };
}

/** Returns false when daily background classify cap is reached (silent degrade). */
export async function tryConsumeBackgroundClassify(userId: string): Promise<boolean> {
  const limit = getBackgroundClassifyDailyLimit();
  const r = getRedis();
  if (!r) return true;

  const key = dailyKey(userId, "background_classify");
  const current = (await r.get<number>(key)) ?? 0;
  if (current >= limit) return false;

  const used = await r.incr(key);
  if (used === 1) await r.expire(key, 48 * 60 * 60);
  if (used > limit) return false;
  return true;
}

export type UsageWarning = { feature: AiFeature; level: "warning" | "limit"; message: string };

const FEATURE_LABELS: Record<AiFeature, string> = {
  agent: "AI Assistant",
  search: "AI Search",
  parse: "Natural Compose",
  brief: "Meeting Brief",
  action_extract: "Action Items",
};

export async function getUsageSummary(userId: string): Promise<{
  planId: "free";
  quotaEnforced: boolean;
  backgroundAiEnabled: boolean;
  backgroundClassify: { used: number; limit: number; remaining: number };
  features: Record<AiFeature, { used: number; limit: number; remaining: number; resetAt: string }>;
  warnings: UsageWarning[];
}> {
  const resetAt = midnightUtc().toISOString();
  const userFeatures: AiFeature[] = ["agent", "search", "parse", "brief", "action_extract"];
  const r = getRedis();
  const warnings: UsageWarning[] = [];

  const features = {} as Record<AiFeature, { used: number; limit: number; remaining: number; resetAt: string }>;
  for (const feature of userFeatures) {
    const limit = FREE_DAILY_LIMITS[feature];
    const used = r ? ((await r.get<number>(dailyKey(userId, feature))) ?? 0) : 0;
    features[feature] = {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetAt,
    };
    const pct = limit > 0 ? (used / limit) * 100 : 0;
    if (used >= limit) {
      warnings.push({
        feature,
        level: "limit",
        message: `You've used all ${limit} ${FEATURE_LABELS[feature]} requests today.`,
      });
    } else if (pct >= 80) {
      warnings.push({
        feature,
        level: "warning",
        message: `You've used ${used} of ${limit} ${FEATURE_LABELS[feature]} requests today.`,
      });
    }
  }

  const bgLimit = getBackgroundClassifyDailyLimit();
  const bgUsed = r ? ((await r.get<number>(dailyKey(userId, "background_classify"))) ?? 0) : 0;

  return {
    planId: "free",
    quotaEnforced: isQuotaEnforced(),
    backgroundAiEnabled: true,
    backgroundClassify: {
      used: bgUsed,
      limit: bgLimit,
      remaining: Math.max(0, bgLimit - bgUsed),
    },
    features,
    warnings,
  };
}
