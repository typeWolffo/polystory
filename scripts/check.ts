// Reads the bytes of a GLB and says whether it may ship: the budgets and
// envelopes come from the profile, the colours from the style, the bones
// from the kind's rig. Exit 1 on any FAIL, 2 on bad usage.
//
//   polystory check [--project <root>] [--kind <kind>] <file.glb> [more.glb…]
import { existsSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

import type { Style } from "./kit/types.ts";
import { materialSummary, meshStats, readGlb, rootTransformOff, skinJointNames, srgbHexToLinear } from "./lib/glb.ts";
import { paint, status as statusLabel } from "./lib/term.ts";
import { findProject, isIgnored, kindOfFile, loadProfile, loadStyle, projectPath, recipeFor, slotOfFile, type Profile } from "./lib/profile.ts";

export type Verdict = { errors: string[]; warnings: string[]; summary: string };

export function checkFile({ root, profile, style, file, kindName }: { root: string; profile: Profile; style: Style | null; file: string; kindName?: string | null }): Verdict {
  const errors: string[] = [];
  const warnings: string[] = [];
  const located = kindOfFile(root, profile, file);
  const name = kindName ?? located?.name;

  if (!name || !profile.kinds[name]) return { errors: [`${file} is not inside any kind's models folder; pass --kind`], warnings, summary: "" };

  const kind = profile.kinds[name];
  const rel = located?.name === name ? located.rel : basename(file);
  const slot = slotOfFile(kind, rel);
  const recipe = located ? recipeFor(root, kind, rel) : null;
  const { json: gltf, bytes } = readGlb(file);
  const nodes = gltf.nodes ?? [];
  const skinned = (gltf.skins?.length ?? 0) > 0;

  if (kind.slots && !slot && located) errors.push(`"${rel}" is not in a slot folder (${Object.values(kind.slots).map((s) => s.folder).join(", ")})`);

  if (skinned && !kind.skinnedBudget) errors.push(`a skinned mesh is not a ${name}: the kind has no skinnedBudget`);

  const budget = skinned && kind.skinnedBudget ? kind.skinnedBudget : kind.budget;

  if ((gltf.scenes?.length ?? 0) !== 1) errors.push(`expected one scene, got ${gltf.scenes?.length ?? 0}`);

  if (gltf.images?.length || gltf.textures?.length) errors.push("textures are not part of the style: flat palette colours only");

  if (gltf.animations?.length) errors.push(`a ${name} carries no animation`);

  for (const index of gltf.scenes?.[0]?.nodes ?? []) {
    const node = nodes[index];

    if (!skinned && rootTransformOff(node)) {
      // A file built from a recipe has no excuse; a hand-made one predates
      // the convention and the loader may tolerate its offset.
      (recipe ? errors : warnings).push(`root node "${node.name}" is not at the origin: the mesh must sit in ${slot ? "its socket's" : "its own"} space`);
    }
  }

  const stats = meshStats(gltf);

  if (stats.nonTriangle) errors.push("a primitive is not a triangle list");

  if (stats.tris > budget.trisMax) errors.push(`${stats.tris} triangles, the cap is ${budget.trisMax}`);
  else if (stats.tris > budget.trisTarget) warnings.push(`${stats.tris} triangles, above the ${budget.trisTarget} target`);

  if (bytes > budget.bytesMax) errors.push(`${bytes} bytes, the cap is ${budget.bytesMax}`);

  const materials = materialSummary(gltf);

  for (const mat of materials) {
    const spec = style?.materials?.[mat.name];

    if (!spec) {
      errors.push(`material "${mat.name}" is not in the style's palette`);
      continue;
    }

    const want = srgbHexToLinear(spec.hex);
    const got = gltf.materials?.find((m) => m.name === mat.name)?.pbrMetallicRoughness?.baseColorFactor ?? [];

    if (want.some((v, i) => Math.abs(v - (got[i] ?? NaN)) > 0.02)) errors.push(`material "${mat.name}" has a colour that is not the palette's ${spec.hex}`);

    if (Math.abs(mat.roughness - spec.roughness) > 0.05) warnings.push(`material "${mat.name}" roughness ${mat.roughness.toFixed(2)}, the palette says ${spec.roughness}`);

    if (spec.emissive && !mat.emissive) errors.push(`material "${mat.name}" should glow and has no emissiveFactor`);

    if (!spec.emissive && mat.emissive) errors.push(`material "${mat.name}" glows and the palette says it must not`);

    if (mat.textured) errors.push(`material "${mat.name}" uses a texture`);
  }

  const perItem = style ? { ...style.knobs, ...(style.perKind?.[name] ?? {}) }.materialsPerItem : undefined;

  if (perItem && materials.length > perItem) warnings.push(`${materials.length} materials, the style allows ${perItem} per item`);

  // glTF is Y-up: the file's y is the recipe's z, its z the recipe's -y.
  if (stats.bounds && !skinned) {
    const b = stats.bounds;
    const local = { x: [b.min[0], b.max[0]], y: [-b.max[2], -b.min[2]], z: [b.min[1], b.max[1]] };
    const env = slot?.spec.envelope ?? (slot ? null : kind.envelope);

    if (env) {
      const abs = (range: number[]) => Math.max(Math.abs(range[0]), Math.abs(range[1]));
      const fmt = (range: number[]) => range.map((v) => v.toFixed(2)).join("..");

      if (env.extentMax !== undefined) {
        const extent = Math.max(local.x[1] - local.x[0], local.y[1] - local.y[0], local.z[1] - local.z[0]);

        if (extent > env.extentMax) warnings.push(`${extent.toFixed(2)} across, a ${name} stays under ${env.extentMax}`);
      }

      if (env.centreMax !== undefined) {
        const centre = Math.max(...[local.x, local.y, local.z].map(([lo, hi]) => Math.abs((lo + hi) / 2)));

        if (centre > env.centreMax) warnings.push(`the bounds are centred ${centre.toFixed(2)} off the origin, which is the pivot`);
      }

      if (env.radiusMax !== undefined && Math.max(abs(local.x), abs(local.y)) > env.radiusMax) warnings.push(`radius ${Math.max(abs(local.x), abs(local.y)).toFixed(2)} is wider than the slot's ${env.radiusMax}`);

      for (const axis of ["x", "y", "z"] as const) {
        const absMax = env[`${axis}AbsMax`];
        const lo = env[`${axis}Min`];
        const hi = env[`${axis}Max`];

        if (absMax !== undefined && abs(local[axis]) > absMax) warnings.push(`${axis} reaches ${fmt(local[axis])}, the slot allows ±${absMax}`);

        if (lo !== undefined && local[axis][0] < lo) warnings.push(`${axis} reaches ${local[axis][0].toFixed(2)}, below the slot's ${lo}`);

        if (hi !== undefined && local[axis][1] > hi) warnings.push(`${axis} reaches ${local[axis][1].toFixed(2)}, above the slot's ${hi}`);
      }
    }
  }

  if (skinned && kind.rig?.glb) {
    const rigPath = projectPath(root, kind.rig.glb);

    if (existsSync(rigPath)) {
      const bones = new Set(skinJointNames(readGlb(rigPath).json).flat());

      for (const joints of skinJointNames(gltf)) {
        const missing = joints.filter((j) => !bones.has(j));

        if (missing.length) errors.push(`skinned to joints the rig does not have: ${missing.join(", ")}`);
      }
    } else {
      warnings.push(`rig.glb ${kind.rig.glb} is missing, the joints were not checked`);
    }
  }

  const summary = `${name}${skinned ? " (skinned)" : ""} · ${stats.tris} tris · ${stats.verts} verts · ${(bytes / 1024).toFixed(0)} kB · ${materials.map((m) => m.name).join(", ") || "no materials"}`;

  return { errors, warnings, summary };
}

export function runCheck(argv: string[]): number {
  const files: string[] = [];
  let kindName: string | null = null;
  let projectArg: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--kind") kindName = argv[++i];
    else if (argv[i] === "--project") projectArg = argv[++i];
    else files.push(argv[i]);
  }

  const root = projectArg ? resolve(projectArg) : findProject();

  if (!root) {
    console.error("no .polystory/profile.json above the working directory: run polystory init, or pass --project");

    return 2;
  }

  if (files.length === 0) {
    console.error("usage: polystory check [--kind <kind>] <file.glb> [more.glb…]");

    return 2;
  }

  const { profile, problems } = loadProfile(root);
  const { style } = loadStyle(root);

  if (problems.length) {
    console.error(`profile problems:\n  ${problems.join("\n  ")}`);

    return 2;
  }

  let failed = false;

  for (const file of files) {
    const abs = resolve(file);
    const shown = relative(process.cwd(), abs).startsWith("..") ? abs : relative(process.cwd(), abs) || abs;

    if (!existsSync(abs) || !statSync(abs).isFile()) {
      console.log(`${statusLabel("FAIL")} ${shown}\n     ${paint("red", "✗ no such file")}`);
      failed = true;
      continue;
    }

    const located = kindOfFile(root, profile, abs);

    if (located && isIgnored(located.kind, located.rel)) {
      console.log(`${statusLabel("SKIP")} ${shown}\n     ${paint("dim", `ignored by the profile (${located.name}.ignore)`)}`);
      continue;
    }

    const { errors, warnings, summary } = checkFile({ root, profile, style, file: abs, kindName });
    const status = errors.length ? "FAIL" : warnings.length ? "WARN" : "OK";
    console.log(`${statusLabel(status)} ${shown}\n     ${paint("dim", summary)}`);

    for (const w of warnings) console.log(`     ${paint("yellow", `! ${w}`)}`);

    for (const e of errors) console.log(`     ${paint("red", `✗ ${e}`)}`);

    if (errors.length) failed = true;
  }

  return failed ? 1 : 0;
}
