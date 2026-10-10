import assert from "node:assert/strict";
import { test } from "node:test";

import { linearToSrgbHex, srgbHexToLinear } from "../scripts/lib/glb.ts";
import { aggregate, type Measure } from "../scripts/scan.ts";

test("colour round trip", () => {
  for (const hex of ["#29004F", "#F6F6F3", "#000000", "#FFFFFF", "#7FA86B"]) assert.equal(linearToSrgbHex(srgbHexToLinear(hex)), hex);
});

test("aggregate counts shading and colours", () => {
  const m = (vertsPerTri: number, hex: string): Measure => ({ file: "x", bytes: 10, tris: 10, verts: 10, vertsPerTri, bounds: null, extent: [1, 1, 1], centre: [0, 0, 0], materials: [{ name: "m", hex, alpha: 1, roughness: 0.5, metallic: 0, emissive: null, emissiveStrength: 0, textured: false, alphaMode: "OPAQUE", doubleSided: false }], textures: 0, animations: [], skins: [], meshNodes: [], empties: [], rootNames: [], edges: { flat: 0.5, soft: 0.3, rounded: 0.2, hard: 0, sharp: 0 } });
  const s = aggregate([m(0.6, "#112233"), m(2.0, "#112233"), m(0.5, "#445566")]);
  assert.equal(s.files, 3);
  assert.equal(s.shading.smooth, 2);
  assert.equal(s.shading.flat, 1);
  assert.equal(s.colours[0].hex, "#112233");
  assert.equal(s.colours[0].files, 2);
});
