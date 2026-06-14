import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

// Auth.js v5 — Google sign-in with JWT sessions (no DB adapter, so our custom
// `users` table stays intact). On sign-in we upsert the user by email and stamp
// `users.id` onto the token; that id IS the Corsair tenant id used everywhere.
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { scope: "openid email profile" } },
    }),
  ],
  callbacks: {
    async jwt({ token, user, profile }) {
      if (user?.email) {
        const [row] = await db
          .insert(users)
          .values({
            email: user.email,
            name: user.name ?? profile?.name ?? null,
            avatarUrl: user.image ?? null,
            googleId: (profile as { sub?: string } | undefined)?.sub ?? null,
          })
          .onConflictDoUpdate({
            target: users.email,
            set: {
              name: user.name ?? null,
              avatarUrl: user.image ?? null,
              updatedAt: new Date(),
            },
          })
          .returning({ id: users.id });
        token.userId = row.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) session.user.id = token.userId as string;
      return session;
    },
  },
});
