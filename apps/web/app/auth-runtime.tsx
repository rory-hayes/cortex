type AuthMode = "sign-in" | "sign-up";

type AuthPageFallbackProps = {
  readonly mode: AuthMode;
};

export const hasAuth0RuntimeConfig = (): boolean =>
  Boolean(process.env.APP_BASE_URL?.trim()) &&
  Boolean(process.env.AUTH0_DOMAIN?.trim()) &&
  Boolean(process.env.AUTH0_CLIENT_ID?.trim()) &&
  Boolean(process.env.AUTH0_CLIENT_SECRET?.trim()) &&
  Boolean(process.env.AUTH0_SECRET?.trim());

const authCopy = {
  "sign-in": {
    action: "Sign in",
    heading: "Sign in to Cortex",
  },
  "sign-up": {
    action: "Create account",
    heading: "Create your Cortex account",
  },
} as const satisfies Record<AuthMode, { action: string; heading: string }>;

export function AuthPageFallback({ mode }: AuthPageFallbackProps) {
  const copy = authCopy[mode];

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 py-12"
      data-auth-page={mode}
    >
      <section className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-sm font-medium text-[var(--primary)]">Cortex</p>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">{copy.heading}</h1>
        </div>
        <div
          className="rounded-lg border border-[var(--border)] bg-white p-6 text-center shadow-sm"
          role="alert"
        >
          <p className="text-base font-semibold text-[var(--foreground)]">
            Authentication setup required
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Configure Auth0 runtime keys before {copy.action.toLowerCase()} can continue.
          </p>
        </div>
      </section>
    </main>
  );
}
