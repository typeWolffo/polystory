import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { startServer, type ReviewPayload, type RunningServer, type StatusPayload, type ViewerConfig } from "./server.ts";
import { THREE_DIR, WEB_DIR } from "./lib/paths.ts";


export type ReviewOpts = {
  glbPath: string;
  refPath?: string;
  rigPath?: string;
  config: ViewerConfig;
  status: () => StatusPayload;
  reviewDir: string;
  port?: number;
  open?: boolean;
  timeoutMs?: number;
};

export function openInBrowser(url: string): void {
  const command = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  const child = spawn(command[0], command.slice(1), { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

// The page polls /status every second (older pages every two); a poll
// after the server came up means a tab is already on it and will follow
// the new review by itself. The wait must outlast one poll interval.
export async function tabIsOpen(server: RunningServer, waitMs = 2500): Promise<boolean> {
  const since = Date.now();

  while (Date.now() - since < waitMs) {
    if (server.lastPollAt() >= since) return true;

    await new Promise((r) => setTimeout(r, 100));
  }

  return false;
}

const MAC_BROWSERS: [string, "chrome" | "arc" | "safari"][] = [
  ["Google Chrome", "chrome"],
  ["Arc", "arc"],
  ["Brave Browser", "chrome"],
  ["Microsoft Edge", "chrome"],
  ["Chromium", "chrome"],
  ["Safari", "safari"],
];

// Brings the tab on `url` to the front, best effort: AppleScript on macOS
// for the browsers that expose their tabs, xdotool on Linux when it is
// there. Elsewhere the tab is left where it is; it has the new model anyway.
export function raiseTab(url: string): boolean {
  if (process.platform === "darwin") {
    for (const [app, family] of MAC_BROWSERS) {
      // pgrep, not System Events: asking a browser that is not running
      // would launch it, and System Events would want its own permission.
      if (spawnSync("pgrep", ["-x", app], { timeout: 2000 }).status !== 0) continue;

      const script = family === "arc"
        ? `tell application "${app}"
            repeat with w in windows
              repeat with t in tabs of w
                if URL of t starts with "${url}" then
                  tell t to select
                  set index of w to 1
                  activate
                  return "ok"
                end if
              end repeat
            end repeat
          end tell
          return "none"`
        : family === "chrome"
        ? `tell application "${app}"
            repeat with w in windows
              set i to 0
              repeat with t in tabs of w
                set i to i + 1
                if URL of t starts with "${url}" then
                  set active tab index of w to i
                  set index of w to 1
                  activate
                  return "ok"
                end if
              end repeat
            end repeat
          end tell
          return "none"`
        : `tell application "${app}"
            repeat with w in windows
              repeat with t in tabs of w
                if URL of t starts with "${url}" then
                  set current tab of w to t
                  set index of w to 1
                  activate
                  return "ok"
                end if
              end repeat
            end repeat
          end tell
          return "none"`;
      const result = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 4000 });

      if (result.stdout?.trim() === "ok") return true;

      // A window the browser's own dictionary does not list (Arc's Little
      // Arc, a popup) still has a title; accessibility can raise it by that.
      const byTitle = spawnSync("osascript", ["-e", `tell application "System Events"
          tell process "${app}"
            set w to first window whose name contains "polystory review"
            perform action "AXRaise" of w
            set frontmost to true
            return "ok"
          end tell
        end tell`], { encoding: "utf8", timeout: 4000 });

      if (byTitle.stdout?.trim() === "ok") return true;
    }

    return false;
  }

  if (process.platform === "linux") {
    const found = spawnSync("xdotool", ["search", "--name", "polystory review"], { encoding: "utf8", timeout: 4000 });
    const id = found.stdout?.trim().split("\n")[0];

    if (found.status === 0 && id) return spawnSync("xdotool", ["windowactivate", id], { timeout: 4000 }).status === 0;
  }

  return false;
}

function nextNumber(dir: string): number {
  if (!existsSync(dir)) return 1;

  const numbers = readdirSync(dir)
    .map((name) => /^(\d+)\.json$/.exec(name)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number);

  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

export async function runReview(opts: ReviewOpts): Promise<ReviewPayload> {
  const port = opts.port ?? 4876;
  let settle: (payload: ReviewPayload) => void = () => {};
  const received = new Promise<ReviewPayload>((resolve) => {
    settle = resolve;
  });
  const server = await startServer({
    webDir: WEB_DIR,
    threeDir: THREE_DIR,
    glbPath: opts.glbPath,
    refPath: opts.refPath,
    rigPath: opts.rigPath,
    config: opts.config,
    status: opts.status,
    onReview: (payload) => settle(payload),
    port,
  });
  let tab: ReviewPayload["tab"] = "none";
  let raised = false;

  // Ask the browser first: a tab left in the background has its timers
  // throttled (Chromium wakes a hidden page about once a minute), so it may
  // not poll for a while, yet it is there. Raising it wakes it up.
  if (opts.open !== false) {
    raised = raiseTab(server.url);

    if (raised || (await tabIsOpen(server))) {
      tab = "reused";
    } else {
      tab = "opened";
      openInBrowser(server.url);
    }
  }

  console.log(`review page: ${server.url}${tab === "reused" ? ` · in the tab already open${raised ? ", brought to the front" : ""}` : tab === "opened" ? " · opened" : ""}`);

  const timer = opts.timeoutMs ? setTimeout(() => settle({ status: "timeout", iteration: opts.status().iteration, general: "", pins: [] }), opts.timeoutMs) : null;

  try {
    const payload = await received;

    if (payload.status === "timeout") return { ...payload, tab };

    const n = nextNumber(opts.reviewDir);
    mkdirSync(opts.reviewDir, { recursive: true });
    const pins = payload.pins.map((pin) => {
      const { screenshot, ...rest } = pin;

      if (!screenshot) return rest;

      const path = join(opts.reviewDir, `${n}-pin-${pin.id}.jpg`);
      writeFileSync(path, Buffer.from(screenshot.split(",")[1], "base64"));

      return { ...rest, screenshotPath: path };
    });
    const file = join(opts.reviewDir, `${n}.json`);
    const result: ReviewPayload = { ...payload, iteration: n, pins, file, tab };
    writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);

    return result;
  } finally {
    if (timer) clearTimeout(timer);

    await server.close();
  }
}
