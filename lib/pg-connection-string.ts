/** Normalize Neon-style URLs so pg v8 stops emitting sslmode deprecation warnings. */
export function normalizePgConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get("sslmode");
    if (sslmode === "require" || sslmode === "prefer" || sslmode === "verify-ca") {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    return connectionString.replace(
      /([?&]sslmode=)(require|prefer|verify-ca)(?=(&|$))/gi,
      "$1verify-full"
    );
  }
}
