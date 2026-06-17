// Authorization for cron endpoints. Accepts any of:
//  - Vercel Cron's `x-vercel-cron` header
//  - `Authorization: Bearer <CRON_SECRET>` (e.g. cron-job.org custom headers)
//  - `?token=<CRON_SECRET>` query param, for schedulers that can only hit a URL
//    with no custom headers (e.g. UptimeRobot free tier)
//
// Note: a query-param secret can show up in server/access logs. Prefer the Bearer
// header where the scheduler supports it.
export function isAuthorizedCron(req: Request): boolean {
  if (req.headers.get("x-vercel-cron") !== null) return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;

  return new URL(req.url).searchParams.get("token") === secret;
}
