// What a skill reads first: the project's profile and style, what is
// missing, how many models and recipes each kind has, and the orphans.
//
//   polystory context [--project <root>] [--json]
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import type { Knobs } from "./kit/types.ts";
import { blenderVersion, findBlender, findProject, isIgnored, loadProfile, loadStyle, PROFILE_DIR, projectPath, recipeFor, SCAN_FILE, STYLE_DOC, type Budget, type Register } from "./lib/profile.ts";
import { findBrowser } from "./render.ts";
import { findGlbs } from "./scan.ts";

type KindContext = {
  models: string;
  recipes: string;
  files: number;
  ignored: number;
  handMade: number;
  recipesCount: number;
  unbuilt: string[];
  slots: string[] | null;
  unitsPerMetre: number;
  budget: Budget;
  skinnedBudget: Budget | null;
  preview: string;
  rig: string | null;
  register: Register | null;
};

export type Context = {
  root: string | null;
  node: string;
  browser: string | null;
  blender: { path: string; version: string } | null;
  profile: { problems: string[] } | null;
  style: { direction: string | null; knobs: Knobs; materials: number; problems: string[]; doc: boolean } | null;
  kinds: Record<string, KindContext>;
  scan: { at: string } | null;
  missing: string[];
};

export function gather(root: string | null): Context {
  const out: Context = { root, node: process.versions.node, browser: null, blender: null, profile: null, style: null, kinds: {}, scan: null, missing: [] };
  out.browser = findBrowser();

  if (!out.browser) out.missing.push("no browser for renders: install Google Chrome, or run `npx playwright install chromium`");

  if (!root) {
    out.missing.push("no .polystory/profile.json: run polystory init");

    return out;
  }

  const { profile, problems } = loadProfile(root);
  out.profile = { problems };
  const blender = findBlender(profile);
  out.blender = blender ? { path: blender, version: blenderVersion(blender)?.text ?? "unknown" } : null;

  if (problems.length) out.missing.push(`profile problems: ${problems.join("; ")}`);

  const { style, problems: styleProblems } = loadStyle(root);
  const doc = existsSync(join(root, PROFILE_DIR, STYLE_DOC));
  out.style = style ? { direction: style.direction ?? null, knobs: style.knobs, materials: Object.keys(style.materials ?? {}).length, problems: styleProblems, doc } : null;

  if (!style) out.missing.push("no .polystory/style.json: run polystory style");
  else if (styleProblems.length) out.missing.push(`style problems: ${styleProblems.join("; ")}`);

  if (style && !doc) out.missing.push("no .polystory/style.md: run polystory style to write the look down");

  for (const [name, kind] of Object.entries(profile.kinds ?? {})) {
    const modelsDir = projectPath(root, kind.models);
    const recipesDir = projectPath(root, kind.recipes);
    const models = findGlbs(modelsDir).map((f) => relative(modelsDir, f));
    const kept = models.filter((rel) => !isIgnored(kind, rel));
    const handMade = kept.filter((rel) => !recipeFor(root, kind, rel));
    const recipes = existsSync(recipesDir) ? findRecipes(recipesDir).map((f) => relative(recipesDir, f)) : [];
    const built = new Set(kept.map((rel) => recipeFor(root, kind, rel)).filter((r): r is string => Boolean(r)).map((r) => relative(recipesDir, r)));
    out.kinds[name] = {
      models: kind.models,
      recipes: kind.recipes,
      files: kept.length,
      ignored: models.length - kept.length,
      handMade: handMade.length,
      recipesCount: recipes.length,
      unbuilt: recipes.filter((r) => !built.has(r)),
      slots: kind.slots ? Object.entries(kind.slots).map(([s, spec]) => `${s} (${spec.folder}/${spec.socket ? ` → ${spec.socket}` : ""})`) : null,
      unitsPerMetre: kind.unitsPerMetre,
      budget: kind.budget,
      skinnedBudget: kind.skinnedBudget ?? null,
      preview: kind.preview?.mount ?? "turntable",
      rig: kind.rig?.glb ?? null,
      register: kind.register ?? null,
    };
  }

  const scanPath = join(root, PROFILE_DIR, SCAN_FILE);
  out.scan = existsSync(scanPath) ? { at: statSync(scanPath).mtime.toISOString() } : null;

  return out;
}

function findRecipes(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith("__") && !entry.name.startsWith(".")) out.push(...findRecipes(join(dir, entry.name)));
    else if (entry.isFile() && /\.(ts|js|mjs)$/.test(entry.name) && !entry.name.startsWith("_")) out.push(join(dir, entry.name));
  }

  return out;
}

export function render(ctx: Context): string {
  const lines: string[] = [];
  lines.push(`project: ${ctx.root ?? "(none)"}`);
  lines.push(`node ${ctx.node} · renders: ${ctx.browser ?? "NO BROWSER"} · blender: ${ctx.blender ? `${ctx.blender.version} (optional, for open and export --fbx)` : "not installed (optional)"}`);

  if (ctx.profile) {
    lines.push(`profile: ${ctx.profile.problems.length ? `PROBLEMS: ${ctx.profile.problems.join("; ")}` : "ok"}`);

    for (const [name, k] of Object.entries(ctx.kinds)) {
      lines.push(`kind ${name}: ${k.files} models in ${k.models} (${k.handMade} hand-made, ${k.ignored} ignored), ${k.recipesCount} recipes in ${k.recipes}${k.unbuilt.length ? `, UNBUILT: ${k.unbuilt.join(", ")}` : ""}`);
      lines.push(`  units/m ${k.unitsPerMetre} · budget ${k.budget.trisTarget}/${k.budget.trisMax} tris, ${Math.round(k.budget.bytesMax / 1024)} kB${k.skinnedBudget ? ` · skinned ${k.skinnedBudget.trisTarget}/${k.skinnedBudget.trisMax}` : ""} · preview ${k.preview}${k.rig ? ` on ${k.rig}` : ""}`);

      if (k.slots) lines.push(`  slots: ${k.slots.join(", ")}`);

      if (k.register?.command) lines.push(`  register: ${k.register.command}`);
      else if (k.register?.doc) lines.push(`  register: ${k.register.doc}`);
      else lines.push("  register: (nothing to do after the build)");
    }
  }

  if (ctx.style) {
    const kn = ctx.style.knobs;
    lines.push(`style: ${ctx.style.direction ?? "unnamed"} · bevel ${kn.bevel}×${kn.bevelSegments} · segments ${kn.segments} · ${kn.smooth ? `smooth, sharp over ${kn.smoothAngle}°` : "flat shaded"} · min thickness ${kn.minThickness} · ${ctx.style.materials} materials${ctx.style.problems.length ? ` · PROBLEMS: ${ctx.style.problems.join("; ")}` : ""}`);
  }

  lines.push(`scan: ${ctx.scan ? ctx.scan.at : "none (polystory scan)"}`);

  if (ctx.missing.length) {
    lines.push("missing:");

    for (const m of ctx.missing) lines.push(`  - ${m}`);
  }

  lines.push(`next: ${nextStep(ctx)}`);

  return lines.join("\n");
}

export function nextStep(ctx: Context): string {
  if (!ctx.root) return "init — no .polystory/profile.json here yet";

  if (ctx.profile?.problems.length) return "doctor — the profile has problems";

  if (!ctx.style || ctx.style.problems.length || !ctx.style.doc) return "style — the profile is in place, the look is not";

  return `new <${Object.keys(ctx.kinds).join("|")}> <id> [description] — profile and style are in place`;
}

export function runContext(argv: string[]): number {
  let projectArg: string | null = null;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project") projectArg = argv[++i];
    else if (argv[i] === "--json") json = true;
  }

  const ctx = gather(projectArg ? resolve(projectArg) : findProject());
  console.log(json ? JSON.stringify(ctx, null, 2) : render(ctx));

  return 0;
}
