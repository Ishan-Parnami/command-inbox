import "server-only";

export type AiFeature =
  | "agent"
  | "search"
  | "parse"
  | "brief"
  | "action_extract";

export type UserFacingFeature = AiFeature;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Free-tier daily limits — override via AI_LIMIT_* env vars without code changes. */
export const FREE_DAILY_LIMITS: Record<UserFacingFeature, number> = {
  agent: envInt("AI_LIMIT_AGENT", 15),
  search: envInt("AI_LIMIT_SEARCH", 30),
  parse: envInt("AI_LIMIT_PARSE", 20),
  brief: envInt("AI_LIMIT_BRIEF", 5),
  action_extract: envInt("AI_LIMIT_ACTION_EXTRACT", 10),
};

export const FREE_BURST_PER_MINUTE: Record<UserFacingFeature, number> = {
  agent: 3,
  search: 5,
  parse: 3,
  brief: 2,
  action_extract: 2,
};

export function getBackgroundClassifyDailyLimit(): number {
  return envInt("BACKGROUND_CLASSIFY_DAILY_LIMIT", 50);
}
