import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

const demoLoginEnabled = process.env.DEMO_LOGIN_ENABLED === "true";

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
    Credentials({
      id: "credentials",
      name: "Demo login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!demoLoginEnabled) return null;

        const email = credentials?.email?.toString().trim().toLowerCase();
        const password = credentials?.password?.toString();
        if (!email || !password) return null;

        const [row] = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            avatarUrl: users.avatarUrl,
            passwordHash: users.passwordHash,
          })
          .from(users)
          .where(eq(users.email, email));

        if (!row?.passwordHash) return null;
        if (!(await compare(password, row.passwordHash))) return null;

        return {
          id: row.id,
          email: row.email,
          name: row.name,
          image: row.avatarUrl,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, profile }) {
      // Always resolve to our DB users.id — Auth.js also sets user.id on OAuth
      // sign-in, but that id is not in our users table and must not be used as
      // the Corsair tenant id.
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
              name: user.name ?? profile?.name ?? null,
              avatarUrl: user.image ?? null,
              googleId: (profile as { sub?: string } | undefined)?.sub ?? null,
              updatedAt: new Date(),
            },
          })
          .returning({ id: users.id });
        token.userId = row.id;
        return token;
      }

      if (user?.id) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) session.user.id = token.userId as string;
      return session;
    },
  },
});
