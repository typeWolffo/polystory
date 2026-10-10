// What a skill reads first: the project's profile and style, what is
// missing, how many models and recipes each kind has, and the orphans.
//
//   node context.mjs [--project <root>] [--json]
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { findGlbs } from "./scan.mjs";
import { blenderVersion, findBlender, findProject, isIgnored, loadProfile, loadStyle, PROFILE_DIR, projectPath, recipeFor, SCAN_FILE, STYLE_DOC } from "./lib/profile.mjs";

export function gather(root) {
  const out = { root, blender: null, profile: null, style: null, kinds: {}, scan: null, missing: [] };
  const blender = findBlender(null);
  out.blender = blender ? { path: blender, version: blenderVersion(blender)?.text ?? "unknown" } : null;

  if (!out.blender) out.missing.push("Blender was not found: install it, or set POLYSTORY_BLENDER / profile.blender");

  if (!root) {
    out.missing.push("no .polystory/profile.json: run /polystory:init");

    return out;
  }

  const { profile, problems } = loadProfile(root);
  out.profile = { problems, blender: profile.blender ?? "auto" };

  if (profile.blender && profile.blender !== "auto") {
    const configured = findBlender(profile);
    out.blender = configured ? { path: configured, version: blenderVersion(configured)?.text ?? "unknown" } : out.blender;
  }

  if (problems.length) out.missing.push(`profile problems: ${problems.join("; ")}`);

  const { style, problems: styleProblems } = loadStyle(root);
  out.style = style ? { direction: style.direction ?? null, knobs: style.knobs, materials: Object.keys(style.materials ?? {}).length, problems: styleProblems, doc: existsSync(join(root, PROFILE_DIR, STYLE_DOC)) } : null;

  if (!style) out.missing.push("no .polystory/style.json: run /polystory:style");
  else if (styleProblems.length) out.missing.push(`style problems: ${styleProblems.join("; ")}`);

  if (style && !out.style.doc) out.missing.push("no .polystory/style.md: run /polystory:style to write the look down");

  for (const [name, kind] of Object.entries(profile.kinds ?? {})) {
    const modelsDir = projectPath(root, kind.models);
    const recipesDir = projectPath(root, kind.recipes);
    const models = findGlbs(modelsDir).map((f) => relative(modelsDir, f));
    const kept = models.filter((rel) => !isIgnored(kind, rel));
    const handMade = kept.filter((rel) => !recipeFor(root, kind, rel));
    const recipes = existsSync(recipesDir) ? findPy(recipesDir).map((f) => relative(recipesDir, f)) : [];
    const built = new Set(kept.filter((rel) => recipeFor(root, kind, rel)).map((rel) => relative(recipesDir, recipeFor(root, kind, rel))));
    const unbuilt = recipes.filter((r) => !built.has(r));

    out.kinds[name] = {
      models: kind.models,
      recipes: kind.recipes,
      files: kept.length,
      ignored: models.length - kept.length,
      handMade: handMade.length,
      recipesCount: recipes.length,
      unbuilt,
      slots: kind.slots ? Object.entries(kind.slots).map(([s, spec]) => `${s} (${spec.folder}/${spec.socket ? ` → ${spec.socket}` : ""})`) : null,
      unitsPerMetre: kind.unitsPerMetre,
      budget: kind.budget,
      skinnedBudget: kind.skinnedBudget ?? null,
      preview: kind.preview?.mount ?? "turntable",
      rig: kind.rig?.blend ?? null,
      register: kind.register ?? null,
    };
  }

  const scanPath = join(root, PROFILE_DIR, SCAN_FILE);
  out.scan = existsSync(scanPath) ? { at: statSync(scanPath).mtime.toISOString() } : null;

  return out;
}

function findPy(dir) {
  const out = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith("__") && !entry.name.startsWith(".")) out.push(...findPy(join(dir, entry.name)));
    else if (entry.isFile() && entry.name.endsWith(".py") && !entry.name.startsWith("_")) out.push(join(dir, entry.name));
  }

  return out;
}

export function render(ctx) {
  const lines = [];
  lines.push(`project: ${ctx.root ?? "(none)"}`);
  lines.push(`blender: ${ctx.blender ? `${ctx.blender.path} (${ctx.blender.version})` : "NOT FOUND"}`);

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
    const kn = ctx.style.knobs ?? {};
    lines.push(`style: ${ctx.style.direction ?? "unnamed"} · bevel ${kn.bevel}×${kn.bevelSegments} · segments ${kn.segments} · ${kn.smooth ? `smooth, sharp over ${kn.smoothAngle}°` : "flat shaded"} · min thickness ${kn.minThickness} · ${ctx.style.materials} materials${ctx.style.problems?.length ? ` · PROBLEMS: ${ctx.style.problems.join("; ")}` : ""}`);
  }

  lines.push(`scan: ${ctx.scan ? ctx.scan.at : "none (polystory scan)"}`);

  if (ctx.missing.length) {
    lines.push("missing:");

    for (const m of ctx.missing) lines.push(`  - ${m}`);
  }

  return lines.join("\n");
}

export function runContext(argv) {
  let projectArg = null;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project") projectArg = argv[++i];
    else if (argv[i] === "--json") json = true;
  }

  const root = projectArg ? resolve(projectArg) : findProject();
  const ctx = gather(root);
  console.log(json ? JSON.stringify(ctx, null, 2) : render(ctx));

  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  process.exit(runContext(process.argv.slice(2)));
}
