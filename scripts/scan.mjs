// Measures every GLB the profile knows about and writes .polystory/scan.json:
// the evidence the style step reads before it writes a palette and knobs, and
// what init reads to propose sockets, budgets and units. Pass --dirs to scan
// folders before a profile exists.
//
//   node scan.mjs [--project <root>] [--dirs <dir,dir…>] [--out <file>] [--quiet]
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import { centreOf, edgeAngles, extentOf, materialSummary, meshStats, nodeWorldPositions, readGlb, skinJointNames } from "./lib/glb.mjs";
import { findProject, isIgnored, loadProfile, projectPath, PROFILE_DIR, SCAN_FILE, recipeFor } from "./lib/profile.mjs";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", ".cache", "coverage"]);

export function findGlbs(dir, depth = 6) {
  const out = [];

  if (!existsSync(dir) || depth < 0) return out;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) out.push(...findGlbs(join(dir, entry.name), depth - 1));
    } else if (entry.name.toLowerCase().endsWith(".glb")) {
      out.push(join(dir, entry.name));
    }
  }

  return out;
}

export function measure(file) {
  const { json, bin, bytes } = readGlb(file);
  const stats = meshStats(json);
  const angles = edgeAngles(json, bin);
  const total = Object.values(angles.buckets).reduce((a, b) => a + b, 0) || 1;
  const share = Object.fromEntries(Object.entries(angles.buckets).map(([k, v]) => [k, +(v / total).toFixed(3)]));
  const positions = nodeWorldPositions(json);
  const empties = [...positions.values()].filter((n) => n.mesh === undefined && n.children.length === 0 && n.name).map((n) => ({ name: n.name, position: n.position.map((v) => +v.toFixed(3)) }));
  const roots = (json.scenes?.[0]?.nodes ?? []).map((i) => json.nodes[i]);

  return {
    file,
    bytes,
    tris: stats.tris,
    verts: stats.verts,
    vertsPerTri: +(stats.verts / Math.max(stats.tris, 1)).toFixed(2),
    bounds: stats.bounds,
    extent: extentOf(stats.bounds).map((v) => +v.toFixed(3)),
    centre: centreOf(stats.bounds).map((v) => +v.toFixed(3)),
    materials: materialSummary(json),
    textures: json.textures?.length ?? 0,
    animations: (json.animations ?? []).map((a) => a.name ?? ""),
    skins: skinJointNames(json),
    meshNodes: (json.nodes ?? []).filter((n) => n.mesh !== undefined).map((n) => n.name ?? ""),
    empties,
    rootNames: roots.map((n) => n.name ?? ""),
    edges: { ...share, count: angles.edges, boundary: angles.boundary },
  };
}

function percentile(values, p) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

export function aggregate(files) {
  const tris = files.map((f) => f.tris);
  const bytes = files.map((f) => f.bytes);
  const extents = files.map((f) => Math.max(...f.extent));
  const colours = new Map();

  for (const f of files) {
    for (const m of f.materials) {
      const key = m.hex;
      const entry = colours.get(key) ?? { hex: key, names: new Set(), files: 0, roughness: new Set(), emissive: 0, metallic: new Set() };
      entry.names.add(m.name);
      entry.files++;
      entry.roughness.add(+m.roughness.toFixed(2));
      entry.metallic.add(+m.metallic.toFixed(2));

      if (m.emissive) entry.emissive++;

      colours.set(key, entry);
    }
  }

  const smooth = files.filter((f) => f.vertsPerTri < 1.0).length;
  const flat = files.filter((f) => f.vertsPerTri >= 1.5).length;
  const bevelled = files.filter((f) => f.edges.soft + f.edges.rounded > 0.4 && f.edges.sharp < 0.1).length;
  const edgeShare = (k) => +(files.reduce((a, f) => a + (f.edges[k] ?? 0), 0) / Math.max(files.length, 1)).toFixed(3);

  return {
    files: files.length,
    tris: { min: percentile(tris, 0), median: percentile(tris, 0.5), p90: percentile(tris, 0.9), max: percentile(tris, 1) },
    bytes: { min: percentile(bytes, 0), median: percentile(bytes, 0.5), p90: percentile(bytes, 0.9), max: percentile(bytes, 1) },
    extent: { min: percentile(extents, 0), median: percentile(extents, 0.5), max: percentile(extents, 1) },
    shading: { smooth, flat, mixed: files.length - smooth - flat },
    bevelled,
    edges: { flat: edgeShare("flat"), soft: edgeShare("soft"), rounded: edgeShare("rounded"), hard: edgeShare("hard"), sharp: edgeShare("sharp") },
    textured: files.filter((f) => f.textures > 0).length,
    skinned: files.filter((f) => f.skins.length > 0).length,
    animated: files.filter((f) => f.animations.length > 0).length,
    colours: [...colours.values()]
      .map((c) => ({ hex: c.hex, names: [...c.names], files: c.files, roughness: [...c.roughness], metallic: [...c.metallic], emissive: c.emissive }))
      .sort((a, b) => b.files - a.files),
  };
}

export function runScan(argv) {
  let projectArg = null;
  let dirs = null;
  let out = null;
  let quiet = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project") projectArg = argv[++i];
    else if (argv[i] === "--dirs") dirs = argv[++i].split(",");
    else if (argv[i] === "--out") out = argv[++i];
    else if (argv[i] === "--quiet") quiet = true;
  }

  const root = projectArg ? resolve(projectArg) : (findProject() ?? process.cwd());
  const report = { scannedAt: new Date().toISOString(), root, kinds: {}, loose: null };

  if (dirs) {
    const files = dirs.flatMap((d) => findGlbs(resolve(root, d))).map(measure);
    report.loose = { dirs, files: files.map((f) => ({ ...f, file: relative(root, f.file) })), summary: aggregate(files) };
  } else {
    if (!existsSync(join(root, PROFILE_DIR, "profile.json"))) {
      console.error("no profile: pass --dirs <folders with GLBs> to scan before init, or run /polystory:init");

      return 2;
    }

    const { profile } = loadProfile(root);

    for (const [name, kind] of Object.entries(profile.kinds)) {
      const dir = projectPath(root, kind.models);
      const all = findGlbs(dir);
      const files = [];
      const ignored = [];

      for (const file of all) {
        const rel = relative(dir, file);

        if (isIgnored(kind, rel)) {
          ignored.push({ rel, ...pickRigFacts(measure(file)) });
          continue;
        }

        const m = measure(file);
        files.push({ ...m, file: relative(root, file), recipe: recipeFor(root, kind, rel) ? relative(root, recipeFor(root, kind, rel)) : null });
      }

      report.kinds[name] = { models: kind.models, files, ignored, summary: aggregate(files) };
    }
  }

  const target = out ? resolve(out) : join(root, PROFILE_DIR, SCAN_FILE);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);

  if (!quiet) {
    for (const [name, k] of Object.entries(report.kinds)) printSummary(name, k.summary, k.ignored);

    if (report.loose) printSummary(`loose (${report.loose.dirs.join(", ")})`, report.loose.summary, []);

    console.log(`\nwritten ${relative(process.cwd(), target) || target}`);
  }

  return 0;
}

function pickRigFacts(m) {
  return { tris: m.tris, skins: m.skins.map((j) => j.length), empties: m.empties, animations: m.animations, extent: m.extent };
}

function printSummary(name, s, ignored) {
  console.log(`${name}: ${s.files} files`);

  if (s.files === 0) return;

  console.log(`  tris ${s.tris.min}..${s.tris.max} (median ${s.tris.median}, p90 ${s.tris.p90}) · bytes median ${s.bytes.median} max ${s.bytes.max}`);
  console.log(`  extent median ${s.extent.median} max ${s.extent.max} · shading smooth ${s.shading.smooth} flat ${s.shading.flat} mixed ${s.shading.mixed} · bevelled ${s.bevelled}`);
  console.log(`  edges flat ${s.edges.flat} soft ${s.edges.soft} rounded ${s.edges.rounded} hard ${s.edges.hard} sharp ${s.edges.sharp}`);
  console.log(`  textured ${s.textured} · skinned ${s.skinned} · animated ${s.animated}`);
  console.log(`  colours: ${s.colours.slice(0, 24).map((c) => `${c.hex} ×${c.files}${c.emissive ? " glow" : ""} (${c.names.slice(0, 3).join("/")})`).join(", ")}${s.colours.length > 24 ? ", …" : ""}`);

  for (const r of ignored) console.log(`  ignored ${r.rel}: ${r.tris} tris, skins ${r.skins.join("/") || "none"}, empties ${r.empties.map((e) => e.name).join(", ") || "none"}`);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  process.exit(runScan(process.argv.slice(2)));
}
