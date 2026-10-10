// The project side of polystory: where .polystory/ is, what it says, and how
// its relative paths resolve. Every script goes through here so the schema is
// read in one place.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Style } from "../kit/types.ts";

export const PROFILE_DIR = ".polystory";
export const PROFILE_FILE = "profile.json";
export const STYLE_FILE = "style.json";
export const STYLE_DOC = "style.md";
export const SCAN_FILE = "scan.json";

export type Budget = { trisTarget: number; trisMax: number; bytesMax: number };
export type Envelope = Record<string, number>;
export type Slot = { folder: string; socket?: string; envelope?: Envelope };
export type Rig = { glb: string; unitsPerMetre?: number; clip?: string; clipAt?: number };
export type Preview = { mount?: "socket" | "beside" | "turntable"; socket?: string; offset?: [number, number, number]; farMetres?: number; scaleFigure?: boolean };
export type Register = { command?: string; doc?: string };
export type Kind = {
  description?: string;
  models: string;
  recipes: string;
  unitsPerMetre: number;
  slots?: Record<string, Slot>;
  budget: Budget;
  skinnedBudget?: Budget;
  envelope?: Envelope;
  rig?: Rig;
  preview?: Preview;
  ignore?: string[];
  register?: Register;
};
export type Profile = { schemaVersion: 1; blender?: string; kinds: Record<string, Kind> };

export function findProject(start = process.cwd()): string | null {
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

export function expandHome(p: string): string {
  return p.startsWith("~/") || p === "~" ? join(homedir(), p.slice(1)) : p;
}

export function projectPath(root: string, p: string): string {
  const expanded = expandHome(p);

  return isAbsolute(expanded) ? expanded : join(root, expanded);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function loadProfile(root: string): { profile: Profile; path: string; problems: string[] } {
  const path = join(root, PROFILE_DIR, PROFILE_FILE);
  const profile = readJson<Profile>(path);

  return { profile, path, problems: validateProfile(profile, root) };
}

export function loadStyle(root: string): { style: Style | null; path: string; problems: string[] } {
  const path = join(root, PROFILE_DIR, STYLE_FILE);

  if (!existsSync(path)) return { style: null, path, problems: [`${relative(root, path)} is missing: run polystory style`] };

  const style = readJson<Style>(path);

  return { style, path, problems: validateStyle(style) };
}

const BUDGET_KEYS = ["trisTarget", "trisMax", "bytesMax"] as const;

export function validateProfile(profile: Partial<Profile>, root: string | null): string[] {
  const problems: string[] = [];

  if (profile.schemaVersion !== 1) problems.push(`schemaVersion ${profile.schemaVersion} is not 1`);

  if (!profile.kinds || typeof profile.kinds !== "object" || Object.keys(profile.kinds).length === 0) {
    problems.push("kinds is empty: at least one kind of model is needed");

    return problems;
  }

  for (const [name, kind] of Object.entries(profile.kinds)) {
    const at = `kinds.${name}`;

    if (!/^[a-z][a-z0-9-]*$/.test(name)) problems.push(`${at}: a kind is a lower-case word`);

    for (const dir of ["models", "recipes"] as const) {
      if (typeof kind[dir] !== "string") problems.push(`${at}.${dir}: a path relative to the project is required`);
      else if (root && !existsSync(projectPath(root, kind[dir]))) problems.push(`${at}.${dir}: ${kind[dir]} does not exist`);
    }

    if (typeof kind.unitsPerMetre !== "number" || kind.unitsPerMetre <= 0) problems.push(`${at}.unitsPerMetre: a positive number is required (1 when the kind is modelled in metres)`);

    for (const budgetKey of ["budget", "skinnedBudget"] as const) {
      const budget = kind[budgetKey];

      if (budget === undefined && budgetKey === "skinnedBudget") continue;

      if (!budget || BUDGET_KEYS.some((k) => typeof budget[k] !== "number")) problems.push(`${at}.${budgetKey}: needs ${BUDGET_KEYS.join(", ")}`);
    }

    for (const [slot, spec] of Object.entries(kind.slots ?? {})) {
      if (typeof spec.folder !== "string") problems.push(`${at}.slots.${slot}.folder: the sub-folder of models/ is required`);
    }

    if (kind.rig) {
      if (typeof kind.rig.glb !== "string") problems.push(`${at}.rig.glb: the rig GLB with its sockets as nodes is required`);
      else if (root && !existsSync(projectPath(root, kind.rig.glb))) problems.push(`${at}.rig.glb: ${kind.rig.glb} does not exist`);
    }

    const mount = kind.preview?.mount ?? "turntable";

    if (!["socket", "beside", "turntable"].includes(mount)) problems.push(`${at}.preview.mount: socket, beside or turntable`);

    if (mount !== "turntable" && !kind.rig?.glb) problems.push(`${at}.preview.mount is ${mount} but there is no rig.glb to mount on`);

    if (mount === "beside" && !kind.preview?.socket) problems.push(`${at}.preview.socket: the rig node a prop is held beside`);

    if (mount === "socket" && !kind.slots) problems.push(`${at}.preview.mount is socket but the kind has no slots with sockets`);
  }

  return problems;
}

export function validateStyle(style: Partial<Style>): string[] {
  const problems: string[] = [];

  if (style.schemaVersion !== 1) problems.push(`style schemaVersion ${style.schemaVersion} is not 1`);

  const knobs = (style.knobs ?? {}) as Record<string, unknown>;

  for (const k of ["bevel", "bevelSegments", "segments", "smoothAngle", "minThickness"]) {
    if (typeof knobs[k] !== "number") problems.push(`style.knobs.${k}: a number is required`);
  }

  if (typeof knobs.smooth !== "boolean") problems.push("style.knobs.smooth: true or false");

  if (!Array.isArray(knobs.sphere) || knobs.sphere.length !== 2) problems.push("style.knobs.sphere: [u, v]");

  const materials = style.materials ?? {};

  if (Object.keys(materials).length === 0) problems.push("style.materials is empty");

  for (const [name, spec] of Object.entries(materials)) {
    if (!/^#[0-9a-fA-F]{6}$/.test(spec.hex ?? "")) problems.push(`style.materials.${name}.hex: #rrggbb`);

    if (typeof spec.roughness !== "number") problems.push(`style.materials.${name}.roughness: a number 0..1`);
  }

  return problems;
}

export type Located = { name: string; kind: Kind; dir: string; rel: string };

export function kindOfFile(root: string, profile: Profile, file: string): Located | null {
  const abs = resolve(file);

  for (const [name, kind] of Object.entries(profile.kinds)) {
    const dir = projectPath(root, kind.models);

    if (abs === dir || abs.startsWith(dir + sep)) return { name, kind, dir, rel: relative(dir, abs) };
  }

  return null;
}

export function slotOfFile(kind: Kind, rel: string): { slot: string; spec: Slot } | null {
  const folder = dirname(rel);

  for (const [slot, spec] of Object.entries(kind.slots ?? {})) {
    if (spec.folder === folder) return { slot, spec };
  }

  return null;
}

export function isIgnored(kind: Kind, rel: string): boolean {
  const name = basename(rel);

  return (kind.ignore ?? []).some((glob) => globToRegExp(glob).test(name) || globToRegExp(glob).test(rel));
}

export function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}

// The recipe of a model mirrors its path: models/<model>.glb is built from
// recipes/<model>.ts (or .js). A file without one was made by hand.
export function recipeFor(root: string, kind: Kind, rel: string): string | null {
  const stem = join(projectPath(root, kind.recipes), rel.replace(/\.glb$/i, ""));

  for (const ext of [".ts", ".js", ".mjs"]) if (existsSync(stem + ext)) return stem + ext;

  return null;
}

export function modelPathFor(root: string, kind: Kind, model: string): string {
  return join(projectPath(root, kind.models), `${model}.glb`);
}

const BLENDER_CANDIDATES: Record<string, string[]> = {
  darwin: ["/Applications/Blender.app/Contents/MacOS/Blender"],
  linux: ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender", "/var/lib/flatpak/exports/bin/org.blender.Blender"],
  win32: ["C:\\Program Files\\Blender Foundation\\Blender\\blender.exe"],
};

export function findBlender(profile: Profile | null): string | null {
  const candidates = [process.env.POLYSTORY_BLENDER, profile?.blender !== "auto" ? profile?.blender : null].filter((c): c is string => Boolean(c)).map(expandHome);
  const onPath = spawnSync(process.platform === "win32" ? "where" : "which", ["blender"], { encoding: "utf8" });

  if (onPath.status === 0) candidates.push(onPath.stdout.trim().split(/\r?\n/)[0]);

  candidates.push(...(BLENDER_CANDIDATES[process.platform] ?? []));

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }

  return null;
}

export function blenderVersion(blender: string): { major: number; minor: number; text: string } | null {
  const out = spawnSync(blender, ["--version"], { encoding: "utf8", timeout: 20000 });
  const match = out.stdout?.match(/Blender\s+(\d+)\.(\d+)/);

  return match ? { major: +match[1], minor: +match[2], text: match[0] } : null;
}
