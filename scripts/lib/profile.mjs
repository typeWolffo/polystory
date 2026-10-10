// The project side of polystory: where .polystory/ is, what it says, and how
// its relative paths resolve. Every script goes through here so the schema is
// read in one place.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export const PROFILE_DIR = ".polystory";
export const PROFILE_FILE = "profile.json";
export const STYLE_FILE = "style.json";
export const STYLE_DOC = "style.md";
export const SCAN_FILE = "scan.json";
export const STAMP_FILE = ".glb-check-stamp";

export function findProject(start = process.cwd()) {
  const explicit = process.env.POLYSTORY_PROJECT;

  if (explicit) return resolve(explicit);

  let dir = resolve(start);

  for (;;) {
    if (existsSync(join(dir, PROFILE_DIR, PROFILE_FILE))) return dir;

    const parent = dirname(dir);

    if (parent === dir) return null;

    dir = parent;
  }
}

export function expandHome(p) {
  return p.startsWith("~/") || p === "~" ? join(homedir(), p.slice(1)) : p;
}

export function projectPath(root, p) {
  const expanded = expandHome(p);

  return isAbsolute(expanded) ? expanded : join(root, expanded);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadProfile(root) {
  const path = join(root, PROFILE_DIR, PROFILE_FILE);
  const profile = readJson(path);
  const problems = validateProfile(profile, root);

  return { profile, path, problems };
}

export function loadStyle(root) {
  const path = join(root, PROFILE_DIR, STYLE_FILE);

  if (!existsSync(path)) return { style: null, path, problems: [`${relative(root, path)} is missing: run /polystory:style`] };

  const style = readJson(path);

  return { style, path, problems: validateStyle(style) };
}

const BUDGET_KEYS = ["trisTarget", "trisMax", "bytesMax"];

export function validateProfile(profile, root) {
  const problems = [];

  if (profile.schemaVersion !== 1) problems.push(`schemaVersion ${profile.schemaVersion} is not 1`);

  if (!profile.kinds || typeof profile.kinds !== "object" || Object.keys(profile.kinds).length === 0) {
    problems.push("kinds is empty: at least one kind of model is needed");

    return problems;
  }

  for (const [name, kind] of Object.entries(profile.kinds)) {
    const at = `kinds.${name}`;

    if (!/^[a-z][a-z0-9-]*$/.test(name)) problems.push(`${at}: a kind is a lower-case word`);

    for (const dir of ["models", "recipes"]) {
      if (typeof kind[dir] !== "string") problems.push(`${at}.${dir}: a path relative to the project is required`);
      else if (root && !existsSync(projectPath(root, kind[dir]))) problems.push(`${at}.${dir}: ${kind[dir]} does not exist`);
    }

    if (typeof kind.unitsPerMetre !== "number" || kind.unitsPerMetre <= 0) problems.push(`${at}.unitsPerMetre: a positive number is required (1 when the kind is modelled in metres)`);

    for (const budgetKey of ["budget", "skinnedBudget"]) {
      const budget = kind[budgetKey];

      if (budget === undefined && budgetKey === "skinnedBudget") continue;

      if (!budget || BUDGET_KEYS.some((k) => typeof budget[k] !== "number")) problems.push(`${at}.${budgetKey}: needs ${BUDGET_KEYS.join(", ")}`);
    }

    if (kind.slots) {
      for (const [slot, spec] of Object.entries(kind.slots)) {
        if (typeof spec.folder !== "string") problems.push(`${at}.slots.${slot}.folder: the sub-folder of models/ is required`);
      }
    }

    if (kind.rig) {
      if (kind.rig.blend && root && !existsSync(projectPath(root, kind.rig.blend))) problems.push(`${at}.rig.blend: ${kind.rig.blend} does not exist`);

      if (kind.rig.glb && root && !existsSync(projectPath(root, kind.rig.glb))) problems.push(`${at}.rig.glb: ${kind.rig.glb} does not exist`);
    }

    const mount = kind.preview?.mount ?? "turntable";

    if (!["socket", "beside", "turntable"].includes(mount)) problems.push(`${at}.preview.mount: socket, beside or turntable`);

    if (mount !== "turntable" && !kind.rig?.blend) problems.push(`${at}.preview.mount is ${mount} but there is no rig.blend to mount on`);

    if (mount === "beside" && !kind.preview?.socket) problems.push(`${at}.preview.socket: the rig object a prop is held beside`);

    if (mount === "socket" && !kind.slots) problems.push(`${at}.preview.mount is socket but the kind has no slots with sockets`);
  }

  return problems;
}

export function validateStyle(style) {
  const problems = [];

  if (style.schemaVersion !== 1) problems.push(`style schemaVersion ${style.schemaVersion} is not 1`);

  const knobs = style.knobs ?? {};

  for (const k of ["bevel", "bevelSegments", "segments", "smoothAngle", "minThickness"]) {
    if (typeof knobs[k] !== "number") problems.push(`style.knobs.${k}: a number is required`);
  }

  if (typeof knobs.smooth !== "boolean") problems.push("style.knobs.smooth: true or false");

  const materials = style.materials ?? {};

  if (Object.keys(materials).length === 0) problems.push("style.materials is empty");

  for (const [name, spec] of Object.entries(materials)) {
    if (!/^#[0-9a-fA-F]{6}$/.test(spec.hex ?? "")) problems.push(`style.materials.${name}.hex: #rrggbb`);

    if (typeof spec.roughness !== "number") problems.push(`style.materials.${name}.roughness: a number 0..1`);
  }

  return problems;
}

export function kindOfFile(root, profile, file) {
  const abs = resolve(file);

  for (const [name, kind] of Object.entries(profile.kinds)) {
    const dir = projectPath(root, kind.models);

    if (abs === dir || abs.startsWith(dir + sep)) return { name, kind, dir, rel: relative(dir, abs) };
  }

  return null;
}

export function slotOfFile(kind, rel) {
  if (!kind.slots) return null;
  const folder = dirname(rel);

  for (const [slot, spec] of Object.entries(kind.slots)) {
    if (spec.folder === folder) return { slot, spec };
  }

  return null;
}

export function isIgnored(kind, rel) {
  const name = basename(rel);

  return (kind.ignore ?? []).some((glob) => globToRegExp(glob).test(name) || globToRegExp(glob).test(rel));
}

export function globToRegExp(glob) {
  return new RegExp(`^${glob.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}

// The recipe of a model mirrors its path: models/<model>.glb is built from
// recipes/<model>.py. A file without one was made by hand.
export function recipeFor(root, kind, rel) {
  const candidate = join(projectPath(root, kind.recipes), rel.replace(/\.glb$/i, ".py"));

  return existsSync(candidate) ? candidate : null;
}

export function knobsFor(style, kindName) {
  return { ...style.knobs, ...(style.perKind?.[kindName] ?? {}) };
}

const BLENDER_CANDIDATES = {
  darwin: ["/Applications/Blender.app/Contents/MacOS/Blender"],
  linux: ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender", "/var/lib/flatpak/exports/bin/org.blender.Blender"],
  win32: ["C:\\Program Files\\Blender Foundation\\Blender\\blender.exe"],
};

export function findBlender(profile) {
  const candidates = [process.env.POLYSTORY_BLENDER, profile?.blender !== "auto" ? profile?.blender : null].filter(Boolean).map(expandHome);
  const onPath = spawnSync(process.platform === "win32" ? "where" : "which", ["blender"], { encoding: "utf8" });

  if (onPath.status === 0) candidates.push(onPath.stdout.trim().split(/\r?\n/)[0]);

  candidates.push(...(BLENDER_CANDIDATES[process.platform] ?? []));

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }

  return null;
}

export function blenderVersion(blender) {
  const out = spawnSync(blender, ["--version"], { encoding: "utf8", timeout: 20000 });
  const match = out.stdout?.match(/Blender\s+(\d+)\.(\d+)(?:\.(\d+))?/);

  return match ? { major: +match[1], minor: +match[2], patch: +(match[3] ?? 0), text: match[0] } : null;
}
