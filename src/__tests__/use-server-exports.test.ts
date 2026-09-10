import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A file marked "use server" may only export async functions. Exporting
 * anything else -- a constant, a class, a plain object -- throws at module
 * load in a production build and takes down every page that imports it,
 * before any request handler runs. The failure looks nothing like a code bug
 * from the outside: an instant 500 with no network activity.
 *
 * TypeScript does not catch it and `next build` did not either, so this does.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

const files = walk(join(process.cwd(), "src"));

const serverFiles = files.filter((path) => {
  const first = readFileSync(path, "utf8").trimStart();
  return first.startsWith('"use server"') || first.startsWith("'use server'");
});

describe('"use server" files', () => {
  it("exist, so this test is actually checking something", () => {
    expect(serverFiles.length).toBeGreaterThan(0);
  });

  it.each(serverFiles.map((path) => [path.replace(process.cwd(), "")]))(
    "%s exports only async functions",
    (relative) => {
      const source = readFileSync(join(process.cwd(), relative), "utf8");

      // Type-only exports are erased before the runtime sees them.
      const runtimeExports = source
        .split("\n")
        .filter((line) => /^export\s/.test(line))
        .filter((line) => !/^export\s+(type|interface)\s/.test(line))
        .filter((line) => !/^export\s*\{\s*type\s/.test(line));

      const offenders = runtimeExports.filter(
        (line) => !/^export\s+async\s+function\s/.test(line),
      );

      expect(offenders).toEqual([]);
    },
  );
});
