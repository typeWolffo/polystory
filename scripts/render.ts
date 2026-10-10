import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { chromium, type Browser } from "playwright-core";

import { startServer, type CheckResult, type ViewerConfig } from "./server.ts";
import { THREE_DIR, WEB_DIR } from "./lib/paths.ts";

const CHROME_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

export type RenderOpts = {
  glbPath: string;
  refPath?: string;
  rigPath?: string;
  config: ViewerConfig;
  out: string;
  views?: string[];
};

export const NO_BROWSER = "no browser for renders: install Google Chrome, or run `npx playwright install chromium`";

export async function launchBrowser(): Promise<Browser> {
  const attempts: (() => Promise<Browser>)[] = [
    () => chromium.launch({ channel: "chrome", headless: true, args: CHROME_ARGS }),
    () => chromium.launch({ channel: "msedge", headless: true, args: CHROME_ARGS }),
    () => chromium.launch({ headless: true, args: CHROME_ARGS }),
  ];

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch {
      continue;
    }
  }

  throw new Error(NO_BROWSER);
}

const BROWSER_CANDIDATES: Record<string, [string, string][]> = {
  darwin: [
    ["Google Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    ["Google Chrome", join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")],
    ["Microsoft Edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
  ],
  win32: [
    ["Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"],
    ["Google Chrome", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"],
    ["Google Chrome", join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe")],
    ["Microsoft Edge", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"],
  ],
  linux: [],
};
const LINUX_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];

// A quick, synchronous answer for context and doctor; launchBrowser() is
// the one that decides at render time.
export function findBrowser(): string | null {
  for (const [label, path] of BROWSER_CANDIDATES[process.platform] ?? []) if (path && existsSync(path)) return `${label} (${path})`;

  if (process.platform === "linux") {
    for (const name of LINUX_NAMES) {
      const which = spawnSync("which", [name], { encoding: "utf8" });

      if (which.status === 0) return `${name} (${which.stdout.trim()})`;
    }
  }

  try {
    const bundled = chromium.executablePath();

    if (bundled && existsSync(bundled)) return `Playwright Chromium (${bundled})`;
  } catch {
    // no bundled browser registered
  }

  return null;
}

export async function hasBrowser(): Promise<boolean> {
  try {
    const browser = await launchBrowser();
    await browser.close();

    return true;
  } catch {
    return false;
  }
}

function stem(path: string): string {
  return basename(path).replace(/\.glb$/i, "");
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const EMPTY_CHECK: CheckResult = { status: "OK", summary: "", warnings: [], errors: [] };

export async function renderViews(opts: RenderOpts): Promise<Record<string, string>> {
  const server = await startServer({
    webDir: WEB_DIR,
    threeDir: THREE_DIR,
    glbPath: opts.glbPath,
    refPath: opts.refPath,
    rigPath: opts.rigPath,
    config: opts.config,
    status: () => ({ model: stem(opts.glbPath), kind: "", recipe: "", iteration: 0, check: EMPTY_CHECK, mtime: 0, style: { materials: {} } }),
    onReview: () => {},
  });
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
    const request = { glbUrl: "/model.glb", refUrl: opts.refPath ? "/ref.glb" : undefined, config: { ...opts.config, rigUrl: opts.rigPath ? "/rig.glb" : undefined }, views: opts.views };
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${server.url}/preview.html?config=${b64url(request)}`);
    await page.waitForFunction(() => (window as unknown as { __polystory?: { done: boolean } }).__polystory?.done === true, null, { timeout: 120000 });
    const bridge = await page.evaluate(() => (window as unknown as { __polystory: { shots: Record<string, string>; error: string | null } }).__polystory);

    if (bridge.error) throw new Error(`${bridge.error}${errors.length ? `\n${errors.join("\n")}` : ""}`);

    mkdirSync(opts.out, { recursive: true });
    const written: Record<string, string> = {};
    const item = stem(opts.glbPath);
    const ref = opts.refPath ? stem(opts.refPath) : null;

    for (const [name, dataUrl] of Object.entries(bridge.shots)) {
      const file = name.startsWith("ref_") ? `ref_${ref}_${name.slice(4)}.png` : `${item}_${name}.png`;
      const path = join(opts.out, file);
      writeFileSync(path, Buffer.from(dataUrl.split(",")[1], "base64"));
      written[name] = path;
    }

    return written;
  } finally {
    await browser.close();
    await server.close();
  }
}
