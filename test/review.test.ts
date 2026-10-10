// The review loop through a real page: a verdict comes back with its pins,
// a second round reuses the tab instead of opening one, and the tab follows
// the agent to the next model. Skips when no browser is installed.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { Browser, Page } from "playwright-core";

import { findBrowser, launchBrowser } from "../scripts/render.ts";
import { runReview } from "../scripts/review.ts";
import type { StatusPayload } from "../scripts/server.ts";

const HERE = dirname(new URL(import.meta.url).pathname);
const FIXTURE = join(HERE, "fixtures/bomb.glb");
const PORT = 4893;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statusFor(glb: string, model: string): () => StatusPayload {
  return () => ({ glb, model, kind: "prop", recipe: "", iteration: 1, check: { status: "OK", summary: "", warnings: [], errors: [] }, mtime: 1, style: { materials: {} } });
}

function review(glb: string, model: string, reviewDir: string, open: boolean) {
  return runReview({ glbPath: glb, config: { mount: "turntable", unitsPerMetre: 1 }, status: statusFor(glb, model), reviewDir, port: PORT, open, timeoutMs: 20000 });
}

test("a tab is reused across rounds and follows the next model", { skip: !findBrowser() && "no browser", timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "polystory-review-"));
  mkdirSync(join(dir, "models"));
  const a = join(dir, "models/a.glb");
  const b = join(dir, "models/b.glb");
  copyFileSync(FIXTURE, a);
  copyFileSync(FIXTURE, b);
  let browser: Browser | null = null;

  try {
    // Round 1: nobody is on the page, but the test must not open the real
    // browser, so it drives its own page instead.
    const first = review(a, "a", join(dir, "review/a"), false);
    await sleep(500);
    browser = await launchBrowser();
    const page: Page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForSelector("#send");
    await page.waitForTimeout(2500);
    await page.fill("#general", "round one");
    await page.click("#send");
    const round1 = await first;
    assert.equal(round1.status, "changes");
    assert.equal(round1.general, "round one");
    assert.equal(round1.tab, "none");

    // Round 2, same model, open allowed: the polling tab is found and reused.
    const second = review(a, "a", join(dir, "review/a"), true);
    await sleep(2500);
    await page.fill("#general", "round two");
    await page.click("#send");
    const round2 = await second;
    assert.equal(round2.tab, "reused");
    assert.equal(round2.general, "round two");
    assert.equal(round2.iteration, 2);

    // Next model: the same tab reloads itself onto it.
    const third = review(b, "b", join(dir, "review/b"), true);
    await page.waitForFunction(() => document.querySelector("#meta code")?.textContent === "b", null, { timeout: 15000 });
    await page.waitForSelector("#accept");
    await page.waitForTimeout(1500);
    await page.click("#accept");
    const round3 = await third;
    assert.equal(round3.tab, "reused");
    assert.equal(round3.status, "accepted");
    assert.equal(round3.glb, b);
  } finally {
    await browser?.close();
  }
});
