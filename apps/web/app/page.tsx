import { redirect } from "next/navigation";

import { auth0 } from "../lib/auth0";

import { hasAuth0RuntimeConfig } from "./auth-runtime";

const dashboardAuthReturnTo = "returnTo=%2Fdashboard";
const signInHref = `/auth/login?${dashboardAuthReturnTo}`;
const signUpHref = `/auth/login?screen_hint=signup&${dashboardAuthReturnTo}`;

export default async function HomePage() {
  if (hasAuth0RuntimeConfig()) {
    const session = await auth0.getSession();

    if (session) {
      redirect("/dashboard");
    }
  }

  return (
    <main className="min-h-screen bg-white">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-between px-6 py-8">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--muted)]">Control Plane</p>
            <h1 className="mt-2 text-2xl font-semibold">Cortex</h1>
          </div>
          <nav className="flex items-center gap-3 text-sm font-semibold">
            <a
              className="rounded-md border border-[var(--line)] px-4 py-2 text-[var(--foreground)]"
              href={signInHref}
            >
              Sign in
            </a>
            <a className="rounded-md bg-[var(--primary)] px-4 py-2 text-white" href={signUpHref}>
              Sign up
            </a>
          </nav>
        </header>

        <div className="max-w-2xl py-20">
          <p className="text-sm font-semibold uppercase text-[var(--primary)]">
            AI Engineering Control Plane
          </p>
          <h2 className="mt-4 text-5xl font-semibold leading-tight text-[var(--foreground)]">
            Coordinate approved engineering work without moving source execution into the web app.
          </h2>
          <p className="mt-6 text-lg leading-8 text-[var(--muted)]">
            Local execution stays on the runner. The hosted surface handles identity, metadata,
            approvals, and audit trails for validated pull requests.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              className="rounded-md bg-[var(--primary)] px-5 py-3 font-semibold text-white"
              href={signUpHref}
            >
              Create account
            </a>
            <a
              className="rounded-md border border-[var(--line)] px-5 py-3 font-semibold text-[var(--foreground)]"
              href={signInHref}
            >
              Open control plane
            </a>
          </div>
        </div>

        <footer className="border-t border-[var(--line)] pt-5 text-sm text-[var(--muted)]">
          Runner execution remains local; web-bound data is limited to metadata, redacted summaries,
          and review state.
        </footer>
      </section>
    </main>
  );
}
