import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { edgeAngles, materialSummary, meshStats, nodeWorldPositions, readGlb, srgbHexToLinear, linearToSrgbHex } from "../scripts/lib/glb.mjs";
import { aggregate, measure } from "../scripts/scan.mjs";

const HERE = dirname(new URL(import.meta.url).pathname);
const FIXTURE = join(HERE, "fixtures/faceted.glb");

test("colour round trip", () => {
  for (const hex of ["#29004F", "#F6F6F3", "#000000", "#FFFFFF", "#7FA86B"]) {
    assert.equal(linearToSrgbHex(srgbHexToLinear(hex)), hex);
  }
});

test("the fixture parses", { skip: !existsSync(FIXTURE) && "no fixture" }, () => {
  const { json, bin, bytes } = readGlb(FIXTURE);
  assert.ok(bytes > 1000);
  assert.ok(bin);
  const stats = meshStats(json);
  assert.equal(stats.tris, 728);
  assert.equal(stats.nonTriangle, false);
  assert.ok(stats.bounds);
  const mats = materialSummary(json);
  assert.deepEqual(mats.map((m) => m.name).sort(), ["accent", "base", "dark", "glow", "light"]);
  assert.equal(mats.find((m) => m.name === "glow").emissive !== null, true);
  assert.equal(mats.find((m) => m.name === "base").hex, "#7FA86B");
  const angles = edgeAngles(json, bin);
  assert.ok(angles.edges > 500);
  // Faceted: a flat-shaded export, so most welded edges are hard or sharp.
  assert.ok(angles.buckets.hard + angles.buckets.sharp > angles.buckets.soft);
  const positions = nodeWorldPositions(json);
  assert.ok([...positions.values()].some((n) => n.mesh !== undefined));
});

test("scan measures and aggregates", { skip: !existsSync(FIXTURE) && "no fixture" }, () => {
  const m = measure(FIXTURE);
  assert.ok(m.vertsPerTri >= 1.5, `flat shading splits vertices: ${m.vertsPerTri}`);
  const summary = aggregate([m, m]);
  assert.equal(summary.files, 2);
  assert.equal(summary.shading.flat, 2);
  assert.equal(summary.colours[0].files, 2);
});
