import { access, readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const navItems = [
  { label: "Overview", href: "/dashboard", route: "./(app)/dashboard/page.tsx" },
  { label: "Workspaces", href: "/workspaces", route: "./(app)/workspaces/page.tsx" },
  {
    label: "Repositories",
    href: "/dashboard/repositories",
    route: "./(app)/dashboard/repositories/page.tsx",
  },
  {
    label: "Findings",
    href: "/dashboard/findings",
    route: "./(app)/dashboard/findings/page.tsx",
  },
  {
    label: "Task Recommendations",
    href: "/dashboard/task-recommendations",
    route: "./(app)/dashboard/task-recommendations/page.tsx",
  },
  { label: "Tasks", href: "/dashboard/tasks", route: "./(app)/dashboard/tasks/page.tsx" },
  {
    label: "Setup PRs",
    href: "/dashboard/setup-prs",
    route: "./(app)/dashboard/setup-prs/page.tsx",
  },
  {
    label: "Weekly Review",
    href: "/dashboard/weekly-review",
    route: "./(app)/dashboard/weekly-review/page.tsx",
  },
  { label: "Runs", href: "/dashboard/runs", route: "./(app)/dashboard/runs/page.tsx" },
  {
    label: "Pull Requests",
    href: "/dashboard/pull-requests",
    route: "./(app)/dashboard/pull-requests/page.tsx",
  },
  {
    label: "Runners",
    href: "/dashboard/runners",
    route: "./(app)/dashboard/runners/page.tsx",
  },
  {
    label: "Approvals",
    href: "/dashboard/approvals",
    route: "./(app)/dashboard/approvals/page.tsx",
  },
  {
    label: "Audit Log",
    href: "/dashboard/audit-log",
    route: "./(app)/dashboard/audit-log/page.tsx",
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    route: "./(app)/dashboard/settings/page.tsx",
  },
] as const;

describe("authenticated app navigation shell", () => {
  test("defines a stable nav item list for every protected dashboard destination", async () => {
    const source = await readAppFile("../components/nav.tsx");

    expect(source).toContain("export const APP_NAV_ITEMS");
    expect(source).toContain('from "next/link"');

    for (const item of navItems) {
      expect(source).toContain(`label: "${item.label}"`);
      expect(source).toContain(`href: "${item.href}"`);
      expect(item.href === "/workspaces" || item.href.startsWith("/dashboard")).toBe(true);
    }

    expect(source).not.toContain('href: "/repositories"');
    expect(source).not.toContain('href: "/tasks"');
    expect(source).not.toContain('href: "/runs"');
  });

  test("wraps protected app routes with the persistent navigation shell", async () => {
    const source = await readAppFile("./(app)/layout.tsx");

    expect(source).toContain('import { AppNav } from "@/components/nav";');
    expect(source).toContain("<AppNav");
    expect(source).toMatch(/<main[\s\S]*{children}[\s\S]*<\/main>/);
  });

  test("creates route files for every navigation destination", async () => {
    await Promise.all(navItems.map((item) => expectFile(item.route)));
  });

  test("prioritizes the repo-readiness path before operational runner pages", async () => {
    const source = await readAppFile("../components/nav.tsx");
    const readinessOrder = [
      'label: "Repositories"',
      'label: "Findings"',
      'label: "Task Recommendations"',
      'label: "Tasks"',
      'label: "Setup PRs"',
      'label: "Runs"',
      'label: "Approvals"',
      'label: "Pull Requests"',
      'label: "Runners"',
    ];
    const indexes = readinessOrder.map((label) => source.indexOf(label));

    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
  });

  test("keeps generic empty states focused on repo scans before runner pairing", async () => {
    const source = await readAppFile("./(app)/dashboard/_components/empty-state.tsx");

    expect(source).toContain("Start repo scan");
    expect(source).toContain('href="/dashboard/repositories"');
    expect(source).toContain("Review findings");
    expect(source).toContain('href="/dashboard/findings"');
    expect(source).toContain('href="/dashboard/runners"');
    expect(source.indexOf('href="/dashboard/repositories"')).toBeLessThan(
      source.indexOf('href="/dashboard/runners"'),
    );
    expect(source).toContain("Create manual task");
    expect(source).toContain('href="/dashboard/tasks/new"');
    expect(source).not.toMatch(/<form|action=|onSubmit|mutation|upload/i);
  });

  test("keeps the shell free of secrets, source payloads, and workspace-specific data loading", async () => {
    const [navSource, layoutSource] = await Promise.all([
      readAppFile("../components/nav.tsx"),
      readAppFile("./(app)/layout.tsx"),
    ]);
    const combinedSource = `${navSource}\n${layoutSource}`;

    expect(combinedSource).not.toMatch(
      /process\.env|CLERK_SECRET_KEY|workspaceId|organizationId|raw source|raw diff|raw patch|source snippet|db\.|drizzle|currentUser|getAuth/i,
    );
  });
});
