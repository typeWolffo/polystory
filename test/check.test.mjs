import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { checkFile } from "../scripts/check.mjs";
import { loadProfile, loadStyle } from "../scripts/lib/profile.mjs";

const HERE = dirname(new URL(import.meta.url).pathname);
const FIXTURE = join(HERE, "fixtures/faceted.glb");
const DIRECTIONS = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(join(HERE, "../skills/polystory/templates/directions.json"), "utf8")));

function project({ budget = { trisTarget: 1000, trisMax: 2000, bytesMax: 100000 }, materials = DIRECTIONS.faceted.materials, envelope } = {}) {
  const root = mkdtempSync(join(tmpdir(), "polystory-check-"));
  mkdirSync(join(root, ".polystory"));
  mkdirSync(join(root, "models"));
  mkdirSync(join(root, "recipes"));
  writeFileSync(join(root, ".polystory/profile.json"), JSON.stringify({ schemaVersion: 1, kinds: { prop: { models: "models", recipes: "recipes", unitsPerMetre: 1, budget, envelope, preview: { mount: "turntable" } } } }));
  writeFileSync(join(root, ".polystory/style.json"), JSON.stringify({ schemaVersion: 1, knobs: { ...DIRECTIONS.faceted.knobs }, materials }));
  copyFileSync(FIXTURE, join(root, "models/calibration.glb"));

  return root;
}

function run(root) {
  const { profile } = loadProfile(root);
  const { style } = loadStyle(root);

  return checkFile({ root, profile, style, file: join(root, "models/calibration.glb") });
}

test("a file within budget and palette is OK", { skip: !existsSync(FIXTURE) && "no fixture" }, () => {
  const { errors, warnings } = run(project());
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes("5 materials")), "materialsPerItem warns");
});

test("over the cap fails, over the target warns", { skip: !existsSync(FIXTURE) && "no fixture" }, () => {
  assert.ok(run(project({ budget: { trisTarget: 100, trisMax: 500, bytesMax: 100000 } })).errors.some((e) => e.includes("the cap is 500")));
  assert.ok(run(project({ budget: { trisTarget: 100, trisMax: 5000, bytesMax: 100000 } })).warnings.some((w) => w.includes("above the 100 target")));
  assert.ok(run(project({ budget: { trisTarget: 1000, trisMax: 5000, bytesMax: 10 } })).errors.some((e) => e.includes("bytes")));
});

test("a colour outside the palette fails", { skip: !existsSync(FIXTURE) && "no fixture" }, () => {
  const materials = { ...DIRECTIONS.faceted.materials, base: { hex: "#FF0000", roughness: 0.95 } };
  const { errors } = run(project({ materials }));
  assert.ok(errors.some((e) => e.includes('"base" has a colour')));
  const { errors: unknown } = run(project({ materials: { base: DIRECTIONS.faceted.materials.base } }));
  assert.ok(unknown.some((e) => e.includes('"accent" is not in the style')));
});

test("the envelope warns", { skip: !existsSync(FIXTURE) && "no fixture" }, () => {
  const { warnings } = run(project({ envelope: { extentMax: 0.5, centreMax: 0.05 } }));
  assert.ok(warnings.some((w) => w.includes("across")));
  assert.ok(warnings.some((w) => w.includes("centred")));
});
