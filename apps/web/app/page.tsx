import { redirect } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  GitPullRequest,
  ListChecks,
  ScanSearch,
} from "lucide-react";

import { auth0 } from "../lib/auth0";

import { hasAuth0RuntimeConfig } from "./auth-runtime";

const dashboardAuthReturnTo = "returnTo=%2Fdashboard";
const signInHref = `/auth/login?${dashboardAuthReturnTo}`;
const signUpHref = `/auth/login?screen_hint=signup&${dashboardAuthReturnTo}`;

const controlLoop = [
  {
    detail: "Metadata-only inventory and readiness signals.",
    icon: ScanSearch,
    label: "Scan",
    title: "Repo readiness",
  },
  {
    detail: "Human-approved setup work becomes a Cortex Task.",
    icon: ListChecks,
    label: "Approve",
    title: "AI-ready task",
  },
  {
    detail: "Source-changing work stays on the local runner.",
    icon: GitBranch,
    label: "Execute",
    title: "Local runner",
  },
  {
    detail: "Validated setup artifacts open as a reviewable PR.",
    icon: GitPullRequest,
    label: "Review",
    title: "Setup PR",
  },
] as const;

export default async function HomePage() {
  if (hasAuth0RuntimeConfig()) {
    const session = await auth0.getSession();

    if (session) {
      redirect("/dashboard");
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_20%_0%,#eef4ff_0,#ffffff_32rem)] text-[var(--foreground)]">
      <section className="mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-[var(--line)]/80 pb-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md border border-[var(--line)] bg-white text-sm font-bold text-[var(--primary)] shadow-sm">
              C
            </div>
            <div>
              <p className="text-[0.72rem] font-semibold uppercase text-[var(--muted)]">
                Control Plane
              </p>
              <h1 className="text-2xl font-semibold">Cortex</h1>
            </div>
          </div>
          <nav className="flex items-center gap-3 text-sm font-semibold">
            <a
              className="rounded-md border border-[var(--line)] bg-white px-4 py-2 text-[var(--foreground)] shadow-sm transition hover:border-[var(--primary)]/40"
              href={signInHref}
            >
              Sign in
            </a>
            <a
              className="rounded-md bg-[var(--primary)] px-4 py-2 text-white shadow-sm transition hover:bg-[var(--primary)]/90"
              href={signUpHref}
            >
              Sign up
            </a>
          </nav>
        </header>

        <div className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_29rem] lg:py-10">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase text-[var(--primary)]">
              AI Engineering Control Plane
            </p>
            <h2 className="mt-4 text-4xl font-semibold leading-tight text-[var(--foreground)] sm:text-5xl lg:text-6xl">
              Turn approved engineering intent into safe, validated pull requests.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)]">
              Local execution stays on the runner. The hosted surface handles identity, metadata,
              approvals, and audit trails without moving source work into the web app.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-[var(--primary)]/90"
                href={signUpHref}
              >
                Create account
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <a
                className="rounded-md border border-[var(--line)] bg-white px-5 py-3 font-semibold text-[var(--foreground)] shadow-sm transition hover:border-[var(--primary)]/40"
                href={signInHref}
              >
                Open control plane
              </a>
            </div>
            <dl className="mt-10 grid max-w-2xl gap-4 sm:grid-cols-3">
              <div className="border-l border-[var(--line)] pl-4">
                <dt className="text-sm font-medium text-[var(--muted)]">Boundary</dt>
                <dd className="mt-1 text-sm font-semibold">Runner executes locally</dd>
              </div>
              <div className="border-l border-[var(--line)] pl-4">
                <dt className="text-sm font-medium text-[var(--muted)]">Review</dt>
                <dd className="mt-1 text-sm font-semibold">Human approval preserved</dd>
              </div>
              <div className="border-l border-[var(--line)] pl-4">
                <dt className="text-sm font-medium text-[var(--muted)]">Evidence</dt>
                <dd className="mt-1 text-sm font-semibold">Validation before PRs</dd>
              </div>
            </dl>
          </div>

          <div
            aria-label="Cortex control loop preview"
            className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-[0_24px_70px_rgba(23,32,51,0.12)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-4">
              <div>
                <p className="text-xs font-semibold uppercase text-[var(--muted)]">Live loop</p>
                <h3 className="mt-1 text-lg font-semibold">Approved setup PR flow</h3>
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                Boundary intact
              </span>
            </div>
            <ol className="mt-4 grid gap-3">
              {controlLoop.map((item, index) => {
                const Icon = item.icon;

                return (
                  <li
                    className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 rounded-md border border-[var(--line)] bg-[var(--background)] px-3 py-3"
                    key={item.title}
                  >
                    <div className="grid size-8 place-items-center rounded-md bg-white text-[var(--primary)]">
                      <Icon aria-hidden="true" className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                        {item.label}
                      </p>
                      <p className="mt-1 text-sm font-semibold">{item.title}</p>
                      <p className="mt-1 text-sm leading-5 text-[var(--muted)]">{item.detail}</p>
                    </div>
                    <span className="text-xs font-semibold text-[var(--muted)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-4 flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p>
                Web-bound data stays limited to metadata, redacted summaries, timestamps, review
                state, and PR evidence.
              </p>
            </div>
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
