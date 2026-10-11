import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { checkFile } from "../scripts/check.ts";
import { buildToFile, loadRecipe } from "../scripts/kit/build.ts";
import type { Style } from "../scripts/kit/types.ts";
import { loadProfile, loadStyle, type Budget, type Envelope } from "../scripts/lib/profile.ts";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = join(HERE, "..");
const DIRECTIONS = JSON.parse(readFileSync(join(ROOT, "skills/polystory/templates/directions.json"), "utf8")) as Record<string, Pick<Style, "knobs" | "materials">>;

async function project({ budget = { trisTarget: 1000, trisMax: 2000, bytesMax: 100000 }, materials = DIRECTIONS.faceted.materials, envelope }: { budget?: Budget; materials?: Style["materials"]; envelope?: Envelope } = {}) {
  const root = mkdtempSync(join(tmpdir(), "polystory-check-"));
  mkdirSync(join(root, ".polystory"));
  mkdirSync(join(root, "models"));
  mkdirSync(join(root, "recipes"));
  writeFileSync(join(root, ".polystory/profile.json"), JSON.stringify({ schemaVersion: 1, kinds: { prop: { models: "models", recipes: "recipes", unitsPerMetre: 1, budget, envelope, preview: { mount: "turntable" } } } }));
  writeFileSync(join(root, ".polystory/style.json"), JSON.stringify({ schemaVersion: 1, knobs: DIRECTIONS.faceted.knobs, materials }));
  const recipe = await loadRecipe(join(ROOT, "skills/polystory/templates/recipes/calibration.ts"));
  buildToFile(recipe, { schemaVersion: 1, knobs: DIRECTIONS.faceted.knobs, materials: DIRECTIONS.faceted.materials }, join(root, "models/calibration.glb"));

  return root;
}

function run(root: string) {
  const { profile } = loadProfile(root);
  const { style } = loadStyle(root);

  return checkFile({ root, profile, style, file: join(root, "models/calibration.glb") });
}

test("a file within budget and palette is OK", async () => {
  const { errors, warnings } = run(await project());
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes("5 materials")), "materialsPerItem warns");
});

test("over the cap fails, over the target warns", async () => {
  assert.ok(run(await project({ budget: { trisTarget: 100, trisMax: 500, bytesMax: 100000 } })).errors.some((e) => e.includes("the cap is 500")));
  assert.ok(run(await project({ budget: { trisTarget: 100, trisMax: 5000, bytesMax: 100000 } })).warnings.some((w) => w.includes("above the 100 target")));
  assert.ok(run(await project({ budget: { trisTarget: 1000, trisMax: 5000, bytesMax: 10 } })).errors.some((e) => e.includes("bytes")));
});

test("a colour outside the palette fails", async () => {
  const materials = { ...DIRECTIONS.faceted.materials, base: { hex: "#FF0000", roughness: 0.95 } };
  assert.ok(run(await project({ materials })).errors.some((e) => e.includes('"base" has a colour')));
  assert.ok(run(await project({ materials: { base: DIRECTIONS.faceted.materials.base } })).errors.some((e) => e.includes('"accent" is not in the style')));
});

test("the envelope warns", async () => {
  const { warnings } = run(await project({ envelope: { extentMax: 0.5, centreMax: 0.05 } }));
  assert.ok(warnings.some((w) => w.includes("across")));
  assert.ok(warnings.some((w) => w.includes("centred")));
});

test("a recipe-built file off the origin is an error, a hand-made one a warning", async () => {
  const root = await project();
  const { profile } = loadProfile(root);
  const { style } = loadStyle(root);
  const ok = checkFile({ root, profile, style, file: join(root, "models/calibration.glb") });
  assert.ok(!ok.errors.some((e) => e.includes("origin")));
});

test("parts and clips pass the check and show in the summary", async () => {
  const root = await project();
  const recipe = await loadRecipe(join(ROOT, "skills/polystory/templates/recipes/animated.ts"));
  recipe.ITEM.id = "chest";
  buildToFile(recipe, { schemaVersion: 1, knobs: DIRECTIONS.faceted.knobs, materials: DIRECTIONS.faceted.materials }, join(root, "models/chest.glb"));
  const { profile } = loadProfile(root);
  const { style } = loadStyle(root);
  const { errors, summary } = checkFile({ root, profile, style, file: join(root, "models/chest.glb") });
  assert.deepEqual(errors, []);
  assert.match(summary, /1 part · clips open 0\.60 s, idle 2\.00 s$/);
});
