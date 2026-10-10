// Where the package's own files are, wherever it runs from: the repo, a
// plugin cache, or an npm install's dist/. The skill folder marks the root.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function packageRoot(from: string): string {
  let dir = from;

  for (;;) {
    if (existsSync(join(dir, "skills", "polystory", "SKILL.md"))) return dir;

    const parent = dirname(dir);

    if (parent === dir) throw new Error(`polystory: no skills/polystory/SKILL.md above ${from}`);

    dir = parent;
  }
}

export const PACKAGE_ROOT = packageRoot(dirname(fileURLToPath(import.meta.url)));
export const SKILL_DIR = join(PACKAGE_ROOT, "skills", "polystory");
export const TEMPLATES_DIR = join(SKILL_DIR, "templates");
export const WEB_DIR = join(PACKAGE_ROOT, "web");
// In an npm install three may be hoisted next to this package, not inside
// it, so node says where it is: its entry is build/three.*, two levels down.
export const THREE_DIR = dirname(dirname(fileURLToPath(import.meta.resolve("three"))));
