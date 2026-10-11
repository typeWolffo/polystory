// The kit beyond the primitives: extrude, loft, hull, raw three.js
// geometry, warps, booleans, parts, markers and clips. Every file is also
// run through Khronos' glTF validator.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import validator from "gltf-validator";

import { buildToFile, loadRecipe } from "../scripts/kit/build.ts";
import type { Kit, Style } from "../scripts/kit/types.ts";
import { accessorArray, meshStats, readGlb } from "../scripts/lib/glb.ts";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = join(HERE, "..");
const TMP = join(HERE, ".tmp");
const DIRECTIONS = JSON.parse(readFileSync(join(ROOT, "skills/polystory/templates/directions.json"), "utf8")) as Record<string, Pick<Style, "knobs" | "materials">>;
const STYLE: Style = { schemaVersion: 1, knobs: DIRECTIONS.faceted.knobs, materials: DIRECTIONS.faceted.materials };

function build(id: string, recipe: (kit: Kit) => void) {
  mkdirSync(TMP, { recursive: true });
  const out = join(TMP, `${id}.glb`);
  const result = buildToFile({ ITEM: { kind: "prop", id, model: id }, build: recipe }, STYLE, out);

  return { result, out, ...readGlb(out) };
}

async function assertValid(out: string): Promise<void> {
  const report = await validator.validateBytes(new Uint8Array(readFileSync(out)));
  const issues = report.issues.messages.filter((m: { severity: number }) => m.severity <= 1).slice(0, 5);
  assert.equal(report.issues.numErrors + report.issues.numWarnings, 0, JSON.stringify(issues));
}

// glTF bounds back into recipe axes: x, then the file's -z, then its y.
function recipeBounds(json: ReturnType<typeof readGlb>["json"]) {
  const { min, max } = meshStats(json).bounds!;

  return { x: [min[0], max[0]], y: [-max[2], -min[2]], z: [min[1], max[1]] };
}

const near = (got: number, want: number, tol: number, what: string) => assert.ok(Math.abs(got - want) < tol, `${what}: ${got.toFixed(4)}, want ${want}`);

test("extrude draws its outline as seen from the front, depth along y", async () => {
  const star = [[0, 0.1], [0.03, 0.03], [0.1, 0.03], [0.045, -0.015], [0.065, -0.09], [0, -0.045], [-0.065, -0.09], [-0.045, -0.015], [-0.1, 0.03], [-0.03, 0.03]] as [number, number][];
  const { json, out } = build("extrude", (kit) => kit.extrude({ outline: star, depth: 0.03, mat: "base" }));
  const b = recipeBounds(json);
  near(b.x[0], -0.1, 2e-3, "left");
  near(b.x[1], 0.1, 2e-3, "right");
  near(b.z[0], -0.09, 2e-3, "bottom");
  near(b.z[1], 0.1, 2e-3, "top");
  near(b.y[1] - b.y[0], 0.03, 1e-3, "depth");
  await assertValid(out);
});

test("a loft runs through its sections, a hull wraps its points, mesh() takes any three.js geometry", async () => {
  const { json, out } = build("loft", (kit) => {
    kit.loft({ sections: [{ at: [0, 0.1, 0], r: 0.02 }, { at: [0, 0, 0], size: [0.12, 0.08] }, { at: [0, -0.12, 0], r: 0.01 }], mat: "base" });
    kit.hull({ points: [[0.3, 0, 0], [0.35, 0.05, 0.02], [0.28, -0.04, 0.05], [0.32, 0.01, 0.1], [0.25, 0.03, 0.03]], mat: "dark" });
    kit.mesh({ geometry: new kit.three.IcosahedronGeometry(0.04, 0), x: -0.3, mat: "accent" });
  });
  const b = recipeBounds(json);
  near(b.y[0], -0.12, 2e-3, "loft front");
  near(b.y[1], 0.1, 2e-3, "loft back");
  near(b.z[1], 0.1, 2e-3, "hull top");
  // An icosahedron's vertices reach 0.85 of its radius along x.
  near(b.x[0], -0.3 - 0.04 * 0.8507, 1e-3, "icosahedron");
  await assertValid(out);
});

test("bend curls a part over its own length", async () => {
  const straight = recipeBounds(build("straight", (kit) => kit.cylinder({ r: 0.02, h: 0.4, mat: "base" })).json);
  const { json, out } = build("bent", (kit) => kit.cylinder({ r: 0.02, h: 0.4, mat: "base", warp: kit.bend({ angle: 90 }) }));
  const bent = recipeBounds(json);
  const radius = 0.4 / (Math.PI / 2);
  near(straight.z[1], 0.4, 1e-3, "straight top");
  near(bent.x[1], radius, 0.01, "a quarter circle reaches its radius sideways");
  near(bent.z[1], radius + 0.02, 0.01, "and its radius up");
  await assertValid(out);
});

test("a cut keeps both materials and leaves no T-junctions", async () => {
  const plain = build("box", (kit) => kit.box({ sx: 0.4, sy: 0.3, sz: 0.2, z: 0.1, mat: "base" }));
  const { json, out, result } = build("cut", (kit) =>
    kit.cut({
      from: (k) => k.box({ sx: 0.4, sy: 0.3, sz: 0.2, z: 0.1, mat: "base" }),
      away: (k) => k.cylinder({ r: 0.06, h: 0.4, z: -0.1, mat: "dark" }),
    }),
  );
  assert.deepEqual(result.materials, ["base", "dark"]);
  assert.ok(result.tris > plain.result.tris);
  const [cut, box] = [recipeBounds(json), recipeBounds(plain.json)];

  for (const axis of ["x", "y", "z"] as const) for (const end of [0, 1]) near(cut[axis][end], box[axis][end], 1e-6, `${axis}${end}`);

  await assertValid(out);
});

test("parts hang from their pivots, markers mark points, clips move parts", async () => {
  mkdirSync(TMP, { recursive: true });
  const recipe = await loadRecipe(join(ROOT, "skills/polystory/templates/recipes/animated.ts"));
  recipe.ITEM.id = "chest";
  const out = join(TMP, "chest.glb");
  const result = buildToFile(recipe, STYLE, out);
  const { json, bin } = readGlb(out);
  const names = json.nodes!.map((n) => n.name);
  assert.deepEqual(result.parts, ["lid"]);
  assert.deepEqual(result.markers, ["loot"]);
  assert.deepEqual(json.scenes![0].nodes, [names.indexOf("chest")]);
  const lid = json.nodes![names.indexOf("lid")];
  assert.deepEqual(lid.translation!.map((v) => +v.toFixed(4)), [0, 0.24, -0.16]);
  assert.deepEqual(json.nodes![names.indexOf("loot")].translation!.map((v) => +v.toFixed(4)), [0, 0.3, 0]);
  assert.equal(json.nodes![names.indexOf("loot")].mesh, undefined);
  // The world bounds of the rest pose are the recipe's own.
  near(meshStats(json).bounds!.max[1], result.max[2], 1e-4, "height in the file");
  const open = json.animations!.find((a) => a.name === "open")!;
  assert.equal(open.channels!.length, 1);
  assert.equal(open.channels![0].target.node, names.indexOf("lid"));
  const sampler = open.samplers![0];
  assert.equal(json.accessors![sampler.input].max![0], 0.6);
  const quats = accessorArray(json, bin!, sampler.output) as Float32Array;

  for (let i = 0; i < quats.length; i += 4) near(Math.hypot(quats[i], quats[i + 1], quats[i + 2], quats[i + 3]), 1, 1e-5, "unit quaternion");

  // -105° about the recipe's x is -105° about the file's x.
  const last = Array.from(quats.slice(-4));
  near(Math.abs(last[0]), Math.sin((105 * Math.PI) / 360), 1e-3, "open x");
  near(Math.abs(last[3]), Math.cos((105 * Math.PI) / 360), 1e-3, "open w");
  await assertValid(out);
});

test("a key a full turn away spins all the way round", async () => {
  const { json, bin, out } = build("spin", (kit) => {
    kit.part({ name: "rotor" }, (k) => k.box({ sx: 0.4, sy: 0.04, sz: 0.02, mat: "base" }));
    kit.clip({ name: "spin", duration: 1 }, { rotor: { rot: [[0, [0, 0, 0]], [1, [0, 0, 360]]] } });
  });
  const quats = accessorArray(json, bin!, json.animations![0].samplers![0].output) as Float32Array;
  const middle = (quats.length / 4 - 1) / 2;
  // Halfway is half a turn about the recipe's z, the file's y.
  near(Math.abs(quats[middle * 4 + 1]), 1, 1e-3, "half a turn");
  await assertValid(out);
});

test("names, keys and targets are checked before anything is written", () => {
  assert.throws(() => build("dup", (kit) => {
    kit.part({ name: "a" }, (k) => k.box({ sx: 0.1, sy: 0.1, sz: 0.1 }));
    kit.marker({ name: "a" });
  }), /taken/);
  assert.throws(() => build("ghost", (kit) => {
    kit.box({ sx: 0.1, sy: 0.1, sz: 0.1 });
    kit.clip({ name: "wave", duration: 1 }, { arm: { rot: [[0, [0, 0, 0]]] } });
  }), /not a part/);
  assert.throws(() => build("late", (kit) => {
    kit.part({ name: "arm" }, (k) => k.box({ sx: 0.1, sy: 0.1, sz: 0.1 }));
    kit.clip({ name: "wave", duration: 1 }, { arm: { rot: [[0, [0, 0, 0]], [2, [0, 0, 90]]] } });
  }), /outside 0\.\.1/);
});
