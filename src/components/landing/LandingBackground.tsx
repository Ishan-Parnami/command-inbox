export function LandingBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-gradient-to-b from-primary/5 via-background to-background dark:from-primary/10"
    >
      <div className="landing-grid absolute inset-0" />
      <div
        className="landing-orb landing-orb-float -left-32 -top-32 size-[28rem]"
        style={{ background: "var(--landing-glow-a)" }}
      />
      <div
        className="landing-orb landing-orb-float-alt right-[-8rem] top-1/4 size-[22rem]"
        style={{ background: "var(--landing-glow-b)" }}
      />
      <div
        className="landing-orb landing-orb-float-slow -bottom-24 left-1/4 size-[26rem]"
        style={{ background: "var(--landing-glow-a)" }}
      />
    </div>
  );
}
