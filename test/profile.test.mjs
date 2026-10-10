import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { globToRegExp, isIgnored, kindOfFile, loadProfile, recipeFor, slotOfFile, validateProfile, validateStyle } from "../scripts/lib/profile.mjs";

const KIND = {
  models: "assets/models",
  recipes: "assets/recipes",
  unitsPerMetre: 1,
  budget: { trisTarget: 100, trisMax: 200, bytesMax: 100000 },
  slots: { hat: { folder: "hats", socket: "socket_hat" } },
  ignore: ["rig*"],
  preview: { mount: "turntable" },
};

function project(kinds = { thing: KIND }) {
  const root = mkdtempSync(join(tmpdir(), "polystory-"));
  mkdirSync(join(root, ".polystory"));
  mkdirSync(join(root, "assets/models/hats"), { recursive: true });
  mkdirSync(join(root, "assets/recipes/hats"), { recursive: true });
  writeFileSync(join(root, ".polystory/profile.json"), JSON.stringify({ schemaVersion: 1, kinds }));

  return root;
}

test("a complete profile validates", () => {
  const root = project();
  const { problems } = loadProfile(root);
  assert.deepEqual(problems, []);
});

test("validation names the field", () => {
  const problems = validateProfile({ schemaVersion: 1, kinds: { x: { ...KIND, unitsPerMetre: 0, budget: {} } } }, null);
  assert.ok(problems.some((p) => p.startsWith("kinds.x.unitsPerMetre")));
  assert.ok(problems.some((p) => p.startsWith("kinds.x.budget")));
});

test("a socket mount needs a rig and slots", () => {
  const problems = validateProfile({ schemaVersion: 1, kinds: { x: { ...KIND, preview: { mount: "socket" } } } }, null);
  assert.ok(problems.some((p) => p.includes("no rig.blend")));
});

test("style validation", () => {
  assert.deepEqual(validateStyle({ schemaVersion: 1, knobs: { bevel: 0.02, bevelSegments: 2, segments: 32, smooth: true, smoothAngle: 45, minThickness: 0.02 }, materials: { base: { hex: "#112233", roughness: 0.5 } } }), []);
  const bad = validateStyle({ schemaVersion: 1, knobs: {}, materials: { base: { hex: "red" } } });
  assert.ok(bad.some((p) => p.includes("materials.base.hex")));
  assert.ok(bad.some((p) => p.includes("knobs.bevel")));
});

test("files resolve to kinds, slots, recipes and ignores", () => {
  const root = project();
  const { profile } = loadProfile(root);
  const file = join(root, "assets/models/hats/bucket.glb");
  writeFileSync(file, "");
  const located = kindOfFile(root, profile, file);
  assert.equal(located.name, "thing");
  assert.equal(located.rel, "hats/bucket.glb");
  assert.equal(slotOfFile(located.kind, located.rel).slot, "hat");
  assert.equal(recipeFor(root, located.kind, located.rel), null);
  writeFileSync(join(root, "assets/recipes/hats/bucket.py"), "");
  assert.equal(recipeFor(root, located.kind, located.rel), join(root, "assets/recipes/hats/bucket.py"));
  assert.equal(isIgnored(located.kind, "rig_v2.glb"), true);
  assert.equal(isIgnored(located.kind, "hats/bucket.glb"), false);
  assert.equal(kindOfFile(root, profile, join(root, "elsewhere/x.glb")), null);
});

test("globs", () => {
  assert.ok(globToRegExp("low_poly*").test("low_poly_character.glb"));
  assert.ok(!globToRegExp("low_poly*").test("hats/low_poly.glb"));
  assert.ok(globToRegExp("*.tmp.glb").test("a.tmp.glb"));
});
