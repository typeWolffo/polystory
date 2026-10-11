import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { buildToFile, loadRecipe } from "../scripts/kit/build.ts";
import type { Style } from "../scripts/kit/types.ts";
import { hasBrowser, renderViews } from "../scripts/render.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "bomb.glb");
const OUT = join(HERE, ".tmp", "render");
const browser = await hasBrowser();

test("the turntable renders the four views", { skip: !browser && "no browser for renders", timeout: 120000 }, async () => {
  rmSync(OUT, { recursive: true, force: true });
  const written = await renderViews({ glbPath: FIXTURE, config: { mount: "turntable", unitsPerMetre: 1, scaleFigure: true }, out: OUT });
  assert.deepEqual(Object.keys(written).sort(), ["front", "quarter", "scale", "top"]);

  for (const path of Object.values(written)) {
    assert.ok(existsSync(path), path);
    assert.ok(statSync(path).size > 10000, `${path} is not an empty frame`);
  }
});

test("a model with clips gets a strip of frames per clip", { skip: !browser && "no browser for renders", timeout: 120000 }, async () => {
  const directions = JSON.parse(readFileSync(join(HERE, "..", "skills/polystory/templates/directions.json"), "utf8")) as Record<string, Pick<Style, "knobs" | "materials">>;
  const recipe = await loadRecipe(join(HERE, "..", "skills/polystory/templates/recipes/animated.ts"));
  const glb = join(OUT, "..", "chest.glb");
  mkdirSync(OUT, { recursive: true });
  buildToFile(recipe, { schemaVersion: 1, knobs: directions.faceted.knobs, materials: directions.faceted.materials }, glb);
  const written = await renderViews({ glbPath: glb, config: { mount: "turntable", unitsPerMetre: 1, scaleFigure: false }, out: OUT, views: ["front"] });
  assert.deepEqual(Object.keys(written).sort(), ["clip_idle", "clip_open", "front"]);
  // Six 360 px frames side by side; the width sits in the PNG's IHDR chunk.
  assert.equal(readFileSync(written.clip_open).readUInt32BE(16), 6 * 360);
});
