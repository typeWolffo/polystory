// A recipe file in, a GLB out. The recipe is imported as a module, so it
// may be TypeScript (node strips the types) or plain JavaScript.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { sampleClips } from "./animate.ts";
import { writeGlb } from "./glb-write.ts";
import { assemble, Kit } from "./kit.ts";
import type { BuildStats, Item, Knobs, Recipe, Style } from "./types.ts";

export async function loadRecipe(path: string): Promise<Recipe> {
  const mod = (await import(`${pathToFileURL(path).href}?t=${Date.now()}`)) as Partial<Recipe>;
  const item = mod.ITEM;

  if (!item || typeof item !== "object") throw new Error(`${path} exports no ITEM`);

  if (typeof mod.build !== "function") throw new Error(`${path} exports no build(kit)`);

  for (const key of ["kind", "id", "model"] as const) {
    if (typeof item[key] !== "string" || !item[key]) throw new Error(`${path}: ITEM.${key} must be a non-empty string`);
  }

  return { ITEM: item as Item, build: mod.build };
}

export function knobsFor(style: Style, kind: string): Knobs {
  return { ...style.knobs, ...(style.perKind?.[kind] ?? {}) };
}

export type BuildResult = BuildStats & { file: string; bytes: number };

export function buildToFile(recipe: Recipe, style: Style, outPath: string, knobs = knobsFor(style, recipe.ITEM.kind)): BuildResult {
  const kit = new Kit(knobs, style.materials, recipe.ITEM.id);
  recipe.build(kit);
  const { root, materials, stats } = assemble(kit, recipe.ITEM.smooth_angle);
  const glb = writeGlb(root, materials.map((name) => ({ name, spec: style.materials[name] })), sampleClips(kit.clips, root));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, glb);

  return { ...stats, file: outPath, bytes: glb.length };
}
