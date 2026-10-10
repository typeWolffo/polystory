// End to end through Blender when it is installed: the calibration set
// under the faceted direction must rebuild to the fixture's statistics.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { meshStats, readGlb } from "../scripts/lib/glb.mjs";
import { findBlender } from "../scripts/lib/profile.mjs";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = join(HERE, "..");
const BLENDER = findBlender(null);
const TMP = join(HERE, ".tmp");

test("the faceted calibration rebuilds to the fixture", { skip: !BLENDER && "Blender not installed", timeout: 180000 }, () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const directions = JSON.parse(readFileSync(join(ROOT, "skills/polystory/templates/directions.json"), "utf8"));
  const result = spawnSync(BLENDER, ["-b", "--factory-startup", "-P", join(ROOT, "scripts/blender/build.py"), "--", join(ROOT, "skills/polystory/templates/recipes/calibration.py"), join(TMP, "calibration.glb"), JSON.stringify({ knobs: directions.faceted.knobs, materials: directions.faceted.materials, item: {} })], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const built = result.stdout.split("\n").find((l) => l.startsWith("BUILT "));
  assert.ok(built, "prints BUILT");
  const info = JSON.parse(built.slice(6));
  assert.equal(info.tris, 728);
  const fixture = join(HERE, "fixtures/faceted.glb");

  if (existsSync(fixture)) {
    assert.equal(meshStats(readGlb(join(TMP, "calibration.glb")).json).tris, meshStats(readGlb(fixture).json).tris);
  }
});
