// The kit end to end: the calibration set under each direction builds in
// node, writes a GLB our own reader parses, with the expected materials,
// shading and bounds.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { buildToFile, loadRecipe } from "../scripts/kit/build.ts";
import { blob } from "../scripts/kit/geometry.ts";
import type { Kit, Style } from "../scripts/kit/types.ts";
import { accessorArray, edgeAngles, materialSummary, meshStats, readGlb } from "../scripts/lib/glb.ts";
import { measure } from "../scripts/scan.ts";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = join(HERE, "..");
const TMP = join(HERE, ".tmp");
const DIRECTIONS = JSON.parse(readFileSync(join(ROOT, "skills/polystory/templates/directions.json"), "utf8")) as Record<string, Pick<Style, "knobs" | "materials">>;

function styleOf(name: string): Style {
  return { schemaVersion: 1, direction: name, knobs: DIRECTIONS[name].knobs, materials: DIRECTIONS[name].materials };
}

test("the calibration set builds under every direction", async () => {
  mkdirSync(TMP, { recursive: true });
  const recipe = await loadRecipe(join(ROOT, "skills/polystory/templates/recipes/calibration.ts"));

  for (const name of Object.keys(DIRECTIONS)) {
    const out = join(TMP, `calibration-${name}.glb`);
    const result = buildToFile(recipe, styleOf(name), out);
    const { json, bin, bytes } = readGlb(out);
    assert.equal(bytes, result.bytes);
    const stats = meshStats(json);
    assert.equal(stats.tris, result.tris, name);
    assert.ok(stats.tris > 400 && stats.tris < 12000, `${name}: ${stats.tris} tris`);
    assert.deepEqual(materialSummary(json).map((m) => m.name).sort(), ["accent", "base", "dark", "glow", "light"]);
    assert.ok(materialSummary(json).find((m) => m.name === "glow")!.emissive, `${name}: glow emits`);
    const glow = json.materials!.find((m) => m.name === "glow")!;
    const strength = DIRECTIONS[name].materials.glow.emissive ?? 0;
    const ratio = glow.emissiveFactor![0] / glow.pbrMetallicRoughness!.baseColorFactor![0];
    assert.ok(Math.abs(ratio - Math.min(strength, 1)) < 0.01, `${name}: emissive scaled by ${strength}, got ${ratio.toFixed(2)}`);
    assert.ok(stats.bounds, "bounds are written");
    // Three mugs-crates-balls in a row, 0.3 m each: about 1.3 m wide, 0.45 m tall (glTF Y).
    assert.ok(Math.abs(stats.bounds!.max[0] - stats.bounds!.min[0] - 1.27) < 0.05, `${name}: width`);
    assert.ok(Math.abs(stats.bounds!.max[1] - 0.45) < 0.02, `${name}: height`);
    assert.ok(edgeAngles(json, bin).edges > 500);
    assert.equal(longestEdge(out), true, `${name}: no triangle spans between parts`);
  }
});

// A corner left unassigned by the shading pass once pointed every such
// triangle at vertex 0, a black fan across the whole set.
function longestEdge(file: string): boolean {
  const { json, bin } = readGlb(file);
  const pos = accessorArray(json, bin!, json.meshes![0].primitives[0].attributes.POSITION) as Float32Array;
  const len = (p: number, q: number) => Math.hypot(pos[p * 3] - pos[q * 3], pos[p * 3 + 1] - pos[q * 3 + 1], pos[p * 3 + 2] - pos[q * 3 + 2]);

  for (const prim of json.meshes![0].primitives) {
    const idx = accessorArray(json, bin!, prim.indices!);

    for (let t = 0; t < idx.length / 3; t++) {
      const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];

      if (a === b || b === c || a === c) return false;

      if (Math.max(len(a, b), len(b, c), len(a, c)) > 0.45) return false;
    }
  }

  return true;
}

test("flat and smooth shading show in the bytes", async () => {
  mkdirSync(TMP, { recursive: true });
  const recipe = await loadRecipe(join(ROOT, "skills/polystory/templates/recipes/calibration.ts"));
  const faceted = measure(buildToFile(recipe, styleOf("faceted"), join(TMP, "shading-faceted.glb")).file);
  const toy = measure(buildToFile(recipe, styleOf("toy"), join(TMP, "shading-toy.glb")).file);
  assert.ok(faceted.vertsPerTri >= 1.5, `faceted splits vertices: ${faceted.vertsPerTri}`);
  assert.ok(toy.vertsPerTri < 1.0, `toy shares vertices: ${toy.vertsPerTri}`);
  assert.ok(faceted.edges.hard + faceted.edges.sharp > faceted.edges.soft, "faceted edges are hard");
  assert.ok(toy.edges.soft + toy.edges.rounded > toy.edges.hard, "toy edges are rounded");
});

test("a recipe with an unknown material fails before writing", async () => {
  const recipe = { ITEM: { kind: "x", id: "x", model: "x" }, build: (kit: { sphere(o: { r: number; mat: string }): void }) => kit.sphere({ r: 1, mat: "nope" }) };
  assert.throws(() => buildToFile(recipe as never, styleOf("toy"), join(TMP, "nope.glb")), /material "nope" is not in the style's palette/);
});

test("a lathe closes its profile, rounds its corners and turns about its origin", () => {
  const style = styleOf("toy");
  const recipe = {
    ITEM: { kind: "x", id: "crystal", model: "crystal" },
    build: (kit: Kit) => kit.lathe({ profile: [[0.04, 0], [0.04, 0.15], [0.018, 0.21]], x: 0.1, rot: [0, 90, 0], mat: "glow", segments: 6, bevel: 0.01 }),
  };
  const out = join(TMP, "lathe.glb");
  const result = buildToFile(recipe, style, out);
  // Laid along +X from x = 0.1: 0.1 + 0.21 at the far end, the radius across.
  assert.ok(Math.abs(result.max[0] - 0.31) < 0.002, `far end ${result.max[0]}`);
  assert.ok(Math.abs(result.min[0] - 0.1) < 0.002, `base ${result.min[0]}`);
  assert.ok(result.max[1] <= 0.0401 && result.max[2] <= 0.0401, "radius 0.04");
  assert.equal(longestEdge(out), true);
});

test("a blob ball shows its own radius, winds outward, and blend decides how far balls melt", () => {
  const lone = blob([[0, 0, 0, 0.2]], 24);
  const pos = lone.attributes.position.array as Float32Array;
  const idx = lone.index!.array;
  let outward = 0;

  for (let v = 0; v < pos.length / 3; v++) assert.ok(Math.abs(Math.hypot(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]) - 0.2) < 0.003, "radius 0.2");

  for (let t = 0; t < idx.length / 3; t++) {
    const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    const u = [0, 1, 2].map((i) => pos[b * 3 + i] - pos[a * 3 + i]);
    const w = [0, 1, 2].map((i) => pos[c * 3 + i] - pos[a * 3 + i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];

    if (n[0] * pos[a * 3] + n[1] * pos[a * 3 + 1] + n[2] * pos[a * 3 + 2] > 0) outward++;
  }

  assert.equal(outward, idx.length / 3, "every face points out");

  // Two balls 1.6 r apart: with a high blend the waist between them fills
  // in, with a low one it pinches.
  const waist = (blend: number) => {
    const g = blob([[-0.08, 0, 0, 0.1], [0.08, 0, 0, 0.1]], 32, blend);
    const p2 = g.attributes.position.array as Float32Array;
    let widest = 0;

    for (let v = 0; v < p2.length / 3; v++) if (Math.abs(p2[v * 3]) < 0.01) widest = Math.max(widest, Math.hypot(p2[v * 3 + 1], p2[v * 3 + 2]));

    return widest;
  };

  assert.ok(waist(0.5) > waist(0.1) + 0.02, `blend 0.5 waist ${waist(0.5).toFixed(3)} vs 0.1 ${waist(0.1).toFixed(3)}`);
  assert.throws(() => blob([], 24), /at least one ball/);
});
