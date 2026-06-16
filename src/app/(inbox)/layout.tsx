// The inbox page (`/`) decides what to show based on auth: the marketing
// LandingPage for logged-out visitors, the inbox for authenticated users. So
// this layout must NOT redirect — doing so hides the landing page.
export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
