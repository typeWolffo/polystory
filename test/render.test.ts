import assert from "node:assert/strict";
import { existsSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

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
