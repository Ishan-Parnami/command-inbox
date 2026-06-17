import { Command, Inbox, Bot, Search, CalendarClock, CheckSquare, Keyboard, 
  // Check 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { AnimatedCounter } from "@/components/landing/AnimatedCounter";
import { PriorityChart } from "@/components/landing/PriorityChart";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

const FEATURES = [
  { icon: Inbox, title: "Priority Inbox", desc: "Every email is classified urgent → low so the important things rise to the top automatically." },
  { icon: Bot, title: "MCP Agent", desc: "An assistant with six real tools that can triage, search, draft, and schedule on your behalf." },
  { icon: Search, title: "Tri-mode AI Search", desc: "Find any email instantly — semantic AI understands meaning, full-text matches keywords, and live Gmail catches the rest. Press ⌘F." },
  { icon: CalendarClock, title: "Pre-meeting Brief", desc: "Walk into every meeting prepared with an AI brief built from related threads." },
  { icon: CheckSquare, title: "Action Board", desc: "To-dos extracted from your urgent and high-priority mail, ready to check off." },
  { icon: Keyboard, title: "Keyboard-first", desc: "Triage at the speed of thought with j/k navigation, single-key actions, and a command palette." },
];

const STEPS = [
  { n: "1", title: "Connect", desc: "Securely link Gmail and Google Calendar in one OAuth click." },
  { n: "2", title: "Sync & classify", desc: "Your inbox is mirrored and every message is prioritized by AI." },
  { n: "3", title: "Act", desc: "Triage, reply, schedule, and stay at Command Inbox — all from the keyboard." },
];

const SHORTCUT_GROUPS: { group: string; items: { keys: string[]; label: string }[] }[] = [
  {
    group: "Navigate",
    items: [
      { keys: ["J"], label: "Next email" },
      { keys: ["K"], label: "Previous email" },
      { keys: ["⌘", "F"], label: "AI search emails" },
      { keys: ["⌘", "K"], label: "Command palette" },
      { keys: ["?"], label: "Show all commands" },
    ],
  },
  {
    group: "Triage",
    items: [
      { keys: ["E"], label: "Archive" },
      { keys: ["S"], label: "Star / unstar" },
      { keys: ["U"], label: "Mark read / unread" },
      { keys: ["H"], label: "Snooze" },
      { keys: ["#"], label: "Trash" },
    ],
  },
  {
    group: "Create & act",
    items: [
      { keys: ["C"], label: "Compose" },
      { keys: ["R"], label: "Reply" },
      { keys: ["F"], label: "Forward" },
      { keys: ["N"], label: "Natural compose" },
      { keys: ["T"], label: "Email → calendar event" },
      { keys: ["⌘", "/"], label: "AI assistant" },
    ],
  },
];

// const TIERS = [
//   { name: "Free", price: "$0", blurb: "For trying it out", features: ["1 mailbox", "Priority inbox", "Basic search", "Keyboard triage"] },
//   { name: "Pro", price: "$12", blurb: "For power users", features: ["Everything in Free", "MCP Agent", "Tri-mode search", "Pre-meeting briefs"], featured: true },
//   { name: "Team", price: "$29", blurb: "For small teams", features: ["Everything in Pro", "Shared contacts", "Team analytics", "Priority support"] },
// ];

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <nav className="flex items-center justify-between px-6 py-4 md:px-10 border-b bg-muted/10">
        <div className="flex items-center gap-2">
          <Command className="size-5 text-primary" />
          <span className="font-semibold tracking-tight">Command Inbox</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <a href="/login" className={cn(buttonVariants({ size: "sm" }))}>
            Sign in
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-16 pb-20 text-center md:pt-24">
        <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
        Command Inbox. <span className="text-primary">In seconds.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground md:text-lg">
          A keyboard-first, AI-native command center for your email and calendar. Triage faster,
          never miss what matters, and let an agent do the busywork.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <a href="/login" className={cn(buttonVariants({ size: "lg" }))}>
            Get started free
          </a>
          <a href="#features" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
            See features
          </a>
        </div>

        {/* CSS inbox mockup */}
        <div className="mx-auto mt-14 max-w-3xl overflow-hidden rounded-xl border bg-card text-left shadow-sm">
          <div className="flex items-center gap-1.5 border-b px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-red-400" />
            <span className="size-2.5 rounded-full bg-amber-400" />
            <span className="size-2.5 rounded-full bg-emerald-400" />
            <span className="ml-3 text-xs text-muted-foreground">Command Inbox</span>
          </div>
          <div className="divide-y">
            {[
              { tag: "Urgent", color: "bg-red-500", from: "Stripe", subj: "Action required: verify your payout account" },
              { tag: "High", color: "bg-amber-500", from: "Jordan Lee", subj: "Re: Q3 launch — need sign-off today" },
              { tag: "Normal", color: "bg-indigo-500", from: "GitHub", subj: "3 pull requests awaiting your review" },
              { tag: "Low", color: "bg-slate-400", from: "Newsletter", subj: "This week in design systems" },
            ].map((r) => (
              <div key={r.subj} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/60 cursor-pointer transition-all duration-200">
                <span className={cn("inline-block size-2 shrink-0 rounded-full", r.color)} />
                <span className="w-28 shrink-0 truncate font-medium">{r.from}</span>
                <span className="truncate text-muted-foreground">{r.subj}</span>
                <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {r.tag}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-muted/10 px-6 py-20 md:px-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-semibold tracking-tight md:text-3xl">
            Everything you need to command your inbox
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border bg-card p-6 hover:bg-muted/60 cursor-default hover:shadow-sm transition-all duration-200">
                <f.icon className="size-6 text-primary" />
                <h3 className="mt-4 font-medium">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats + chart */}
      <section className="px-6 py-20 md:px-10">
        <div className="mx-auto grid max-w-5xl items-center gap-12 md:grid-cols-2">
          <div className="grid grid-cols-3 gap-6 text-center">
            <div className="hover:scale-105 transition-all duration-300 cursor-default hover:bg-muted/60 rounded-full aspect-square flex flex-col items-center justify-center">
              <div className="text-3xl font-bold text-primary md:text-4xl">
                <AnimatedCounter value={184} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">emails triaged daily</div>
            </div>
            <div className="hover:scale-105 transition-all duration-300 cursor-default hover:bg-muted/60 rounded-full aspect-square flex flex-col items-center justify-center">
              <div className="text-3xl font-bold text-primary md:text-4xl">
                <AnimatedCounter value={92} suffix="%" />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">classified correctly</div>
            </div>
            <div className="hover:scale-105 transition-all duration-300 cursor-default hover:bg-muted/60 rounded-full aspect-square flex flex-col items-center justify-center">
              <div className="text-3xl font-bold text-primary md:text-4xl">
                <AnimatedCounter value={3} suffix="h" />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">saved per week</div>
            </div>
          </div>
          <div className="rounded-xl border bg-card p-6">
            <h3 className="mb-2 text-sm font-medium">Priority distribution</h3>
            <PriorityChart />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-muted/10 px-6 py-20 md:px-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-semibold tracking-tight md:text-3xl">How it works</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="text-center">
                <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {s.n}
                </div>
                <h3 className="mt-4 font-medium">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Keyboard shortcuts */}
      <section className="px-6 py-20 md:px-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-3 flex items-center justify-center gap-2">
            <Keyboard className="size-5 text-primary" />
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Built for your keyboard</h2>
          </div>
          <p className="mx-auto mb-12 max-w-xl text-center text-sm text-muted-foreground">
            Every action is a keystroke away. Fly through your inbox without ever touching the mouse.
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SHORTCUT_GROUPS.map((g) => (
              <div key={g.group} className="rounded-xl border bg-card p-6">
                <h3 className="mb-4 text-sm font-semibold text-primary">{g.group}</h3>
                <ul>
                  {g.items.map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-3 hover:bg-muted/60 cursor-alias rounded-md p-2 transition-all duration-200">
                      <span className="text-sm text-muted-foreground">{s.label}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {s.keys.map((k) => (
                          <kbd
                            key={k}
                            className="inline-flex min-w-6 items-center justify-center rounded-md border border-b-2 bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground shadow-sm"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing - future scope*/}
      {/* <section className="px-6 py-20 md:px-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-semibold tracking-tight md:text-3xl">
            Awesome pricing
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {TIERS.map((t) => (
              <div
                key={t.name}
                className={cn(
                  "flex flex-col rounded-xl border bg-card p-6",
                  t.featured && "ring-2 ring-primary"
                )}
              >
                <h3 className="font-medium">{t.name}</h3>
                <p className="text-sm text-muted-foreground">{t.blurb}</p>
                <div className="mt-4 text-3xl font-bold">
                  {t.price}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </div>
                <ul className="mt-6 flex-1 space-y-2 text-sm">
                  {t.features.map((feat) => (
                    <li key={feat} className="flex items-center gap-2">
                      <Check className="size-4 text-primary" />
                      {feat}
                    </li>
                  ))}
                </ul>
                <a
                  href="/login"
                  className={cn(
                    buttonVariants({ variant: t.featured ? "default" : "outline" }),
                    "mt-6 w-full"
                  )}
                >
                  Get {t.name}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section> */}

      <footer className="p-4 text-center text-sm text-muted-foreground md:px-10">
        all rights reserved © 2026 @ishan_dev
      </footer>
    </div>
  );
}
