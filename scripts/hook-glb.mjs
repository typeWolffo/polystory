// PostToolUse hook on Bash: when a shell command named a models folder of
// the project, check every GLB written there since the last look. Silent
// when there is no profile or nothing changed.
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { checkFile } from "./check.mjs";
import { findGlbs } from "./scan.mjs";
import { isIgnored, loadProfile, loadStyle, PROFILE_DIR, projectPath, STAMP_FILE } from "./lib/profile.mjs";

let input = "";

try {
  input = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

let payload;

try {
  payload = JSON.parse(input);
} catch {
  process.exit(0);
}

const root = process.env.CLAUDE_PROJECT_DIR ?? payload.cwd ?? process.cwd();
const command = payload.tool_input?.command ?? "";

if (!existsSync(join(root, PROFILE_DIR, "profile.json"))) process.exit(0);

const { profile, problems } = loadProfile(root);

if (problems.length) process.exit(0);

const mentioned = Object.values(profile.kinds).some((kind) => command.includes(kind.models));

if (!mentioned) process.exit(0);

const stamp = join(root, PROFILE_DIR, STAMP_FILE);

if (!existsSync(stamp)) {
  writeFileSync(stamp, "");
  process.exit(0);
}

const since = statSync(stamp).mtimeMs;
const now = new Date();
utimesSync(stamp, now, now);
const { style } = loadStyle(root);
const lines = [];
let failed = false;

for (const kind of Object.values(profile.kinds)) {
  const dir = projectPath(root, kind.models);

  for (const file of findGlbs(dir)) {
    const rel = relative(dir, file);

    if (isIgnored(kind, rel) || statSync(file).mtimeMs <= since) continue;

    const { errors, warnings, summary } = checkFile({ root, profile, style, file });
    const status = errors.length ? "FAIL" : warnings.length ? "WARN" : "OK";
    lines.push(`${status} ${relative(root, file)}: ${summary}`, ...warnings.map((w) => `  ! ${w}`), ...errors.map((e) => `  ✗ ${e}`));

    if (errors.length) failed = true;
  }
}

if (lines.length === 0) process.exit(0);

const text = `polystory check of the GLBs just written:\n${lines.join("\n")}`;

if (failed) {
  console.error(text);
  process.exit(2);
}

console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }));
