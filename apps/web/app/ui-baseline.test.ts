import { access, readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

describe("shadcn UI baseline", () => {
  const escapedDependency = (dependency: string) =>
    dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  test("configures shadcn for the web app globals and aliases", async () => {
    const config = JSON.parse(await readAppFile("../components.json")) as {
      aliases?: Record<string, string>;
      tailwind?: {
        css?: string;
        cssVariables?: boolean;
      };
    };

    expect(config.tailwind?.css).toBe("app/globals.css");
    expect(config.tailwind?.cssVariables).toBe(true);
    expect(config.aliases?.components).toBe("@/components");
    expect(config.aliases?.ui).toBe("@/components/ui");
    expect(config.aliases?.utils).toBe("@/lib/utils");
  });

  test("provides the shared cn utility and required primitive files", async () => {
    const utilsSource = await readAppFile("../lib/utils.ts");

    expect(utilsSource).toContain("import { clsx");
    expect(utilsSource).toContain('from "clsx"');
    expect(utilsSource).toContain('from "tailwind-merge"');
    expect(utilsSource).toContain("export function cn");

    await Promise.all(
      [
        "../components/ui/badge.tsx",
        "../components/ui/button.tsx",
        "../components/ui/dialog.tsx",
        "../components/ui/field.tsx",
        "../components/ui/input.tsx",
        "../components/ui/label.tsx",
        "../components/ui/select.tsx",
        "../components/ui/table.tsx",
        "../components/ui/tabs.tsx",
        "../components/ui/textarea.tsx",
      ].map(expectFile),
    );
  });

  test("uses Radix-backed shadcn primitives instead of inert static wrappers", async () => {
    const [buttonSource, dialogSource, selectSource, tabsSource] = await Promise.all([
      readAppFile("../components/ui/button.tsx"),
      readAppFile("../components/ui/dialog.tsx"),
      readAppFile("../components/ui/select.tsx"),
      readAppFile("../components/ui/tabs.tsx"),
    ]);

    expect(buttonSource).toContain('from "@radix-ui/react-slot"');
    expect(buttonSource).toContain('from "class-variance-authority"');
    expect(buttonSource).toContain("Slot");
    expect(buttonSource).toContain("cva(");

    expect(dialogSource).toContain('from "@radix-ui/react-dialog"');
    expect(dialogSource).toContain("DialogPrimitive.Root");
    expect(dialogSource).toContain("DialogPrimitive.Trigger");
    expect(dialogSource).toContain("DialogPrimitive.Portal");
    expect(dialogSource).toContain("DialogPrimitive.Overlay");
    expect(dialogSource).toContain("DialogPrimitive.Content");
    expect(dialogSource).toContain("DialogPrimitive.Title");

    expect(selectSource).toContain('from "@radix-ui/react-select"');
    expect(selectSource).toContain("SelectPrimitive.Root");
    expect(selectSource).toContain("SelectPrimitive.Trigger");
    expect(selectSource).toContain("SelectPrimitive.Portal");
    expect(selectSource).toContain("SelectPrimitive.Content");
    expect(selectSource).toContain("SelectPrimitive.Viewport");
    expect(selectSource).toContain("SelectPrimitive.Item");
    expect(selectSource).toContain("SelectPrimitive.ItemText");

    expect(tabsSource).toContain('from "@radix-ui/react-tabs"');
    expect(tabsSource).toContain("TabsPrimitive.Root");
    expect(tabsSource).toContain("TabsPrimitive.List");
    expect(tabsSource).toContain("TabsPrimitive.Trigger");
    expect(tabsSource).toContain("TabsPrimitive.Content");
  });

  test("tracks shadcn primitive dependencies in package metadata and the lockfile", async () => {
    const packageJson = JSON.parse(await readAppFile("../package.json")) as {
      dependencies?: Record<string, string>;
    };
    const lockfile = await readAppFile("../../../pnpm-lock.yaml");
    const requiredDependencies = [
      "@radix-ui/react-dialog",
      "@radix-ui/react-select",
      "@radix-ui/react-slot",
      "@radix-ui/react-tabs",
      "class-variance-authority",
      "clsx",
      "lucide-react",
      "tailwind-merge",
    ];

    for (const dependency of requiredDependencies) {
      expect(packageJson.dependencies?.[dependency], `${dependency} package.json entry`).toBeTypeOf(
        "string",
      );
      expect(lockfile, `${dependency} lockfile entry`).toMatch(
        new RegExp(`['"]?${escapedDependency(dependency)}['"]?:`),
      );
      expect(lockfile, `${dependency} resolved package entry`).toContain(`${dependency}@`);
    }
  });

  test("composes the primitives in a protected internal route without unsafe client data", async () => {
    const pageSource = await readAppFile("./(app)/dashboard/ui-baseline/page.tsx");

    ["Field", "Input", "Textarea", "Select", "Table", "Badge", "Dialog", "Tabs"].forEach(
      (componentName) => {
        expect(pageSource).toContain(componentName);
      },
    );

    expect(pageSource).toContain("<TabsList");
    expect(pageSource).toContain("<TabsTrigger");
    expect(pageSource).toContain("<DialogTitle");
    expect(pageSource).not.toMatch(
      /process\.env|CLERK_SECRET_KEY|\btoken\b|raw diff|raw patch|source snippet/i,
    );
  });
});
