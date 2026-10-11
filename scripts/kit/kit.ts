// The object a recipe's build() receives, and the assembly of what it made:
// one mesh per part, each with material groups, creased or flat normals and
// shared vertices; parts hang from their pivots, markers name points, clips
// move parts.
import * as THREE from "three";
import { Box3, BufferGeometry } from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { ParametricGeometry } from "three/examples/jsm/geometries/ParametricGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { boolean } from "./csg.ts";
import * as geo from "./geometry.ts";
import { shade } from "./shade.ts";
import type {
  BlobOpts, BoxOpts, BuildStats, ClipOpts, ConeOpts, CutOpts, CylinderOpts, ExtrudeOpts, HullOpts, IntersectOpts, Kit as KitApi, Knobs, LatheOpts, LoftOpts,
  MarkerOpts, MaterialSpec, MeshOpts, PartOpts, SphereOpts, TorusOpts, Track, TubeOpts, Vec3, Warp,
} from "./types.ts";

export type Shape = { geometry: BufferGeometry; mat: string };
export type Marker = { name: string; at: Vec3; rot: Vec3 };
export type PartNode = { name: string; pivot: Vec3; shapes: Shape[]; children: PartNode[]; markers: Marker[] };
export type ClipSpec = { name: string; duration: number; fps: number; tracks: Record<string, Track> };

const listOf = (warp?: Warp | Warp[]) => (warp ? (Array.isArray(warp) ? warp : [warp]) : []);

export class Kit implements KitApi {
  readonly root: PartNode;
  readonly clips: ClipSpec[] = [];
  readonly knobs: Knobs;
  readonly materials: Record<string, MaterialSpec>;
  readonly three = THREE;
  readonly addons = { ConvexGeometry, ParametricGeometry };
  private current: PartNode;
  private readonly names = new Set<string>();

  constructor(knobs: Knobs, materials: Record<string, MaterialSpec>, rootName = "root") {
    this.knobs = knobs;
    this.materials = materials;
    this.root = { name: rootName, pivot: [0, 0, 0], shapes: [], children: [], markers: [] };
    this.current = this.root;
    this.names.add(rootName);
  }

  private add(geometry: BufferGeometry, mat: string | undefined, x = 0, y = 0, z = 0, rot?: Vec3, warp?: Warp | Warp[]): void {
    const name = mat ?? "base";

    if (!this.materials[name]) {
      throw new Error(`material "${name}" is not in the style's palette (${Object.keys(this.materials).sort().join(", ") || "empty"})`);
    }

    const shaped = geo.applyWarps(geometry, listOf(warp));
    shaped.applyMatrix4(geo.placement(x, y, z, rot));
    this.current.shapes.push({ geometry: shaped, mat: name });
  }

  private claim(name: string): void {
    if (!name) throw new Error("parts and markers need a name");

    if (this.names.has(name)) throw new Error(`the name "${name}" is taken: parts, markers and the item need unique names`);

    this.names.add(name);
  }

  // Runs a cut's operand into a scratch node, so its shapes stay out of the
  // part being built until the cut is done.
  private collect(build: (kit: KitApi) => void): Shape[] {
    const scratch: PartNode = { name: this.current.name, pivot: this.current.pivot, shapes: [], children: [], markers: [] };
    const saved = this.current;
    this.current = scratch;

    try {
      build(this);
    } finally {
      this.current = saved;
    }

    if (scratch.children.length || scratch.markers.length) throw new Error("cut() and intersect() take shapes only: no part() or marker() inside");

    if (scratch.shapes.length === 0) throw new Error("an operand of cut() or intersect() built nothing");

    return scratch.shapes;
  }

  cylinder({ r, h, x = 0, y = 0, z = 0, mat, rot, bevel, segments, bevel_segments, warp }: CylinderOpts): void {
    this.add(geo.cylinder(r, h, bevel ?? this.knobs.bevel, segments ?? this.knobs.segments, bevel_segments ?? this.knobs.bevelSegments), mat, x, y, z + h / 2, rot, warp);
  }

  cone({ r1, r2, h, x = 0, y = 0, z = 0, mat, rot, bevel, segments, bevel_segments, warp }: ConeOpts): void {
    this.add(geo.cone(r1, Math.max(r2, 0), h, bevel ?? this.knobs.bevel, segments ?? this.knobs.segments, bevel_segments ?? this.knobs.bevelSegments), mat, x, y, z + h / 2, rot, warp);
  }

  sphere({ r, x = 0, y = 0, z = 0, mat, rot, u, v, scale = [1, 1, 1], warp }: SphereOpts): void {
    this.add(geo.sphere(r, u ?? this.knobs.sphere[0], v ?? this.knobs.sphere[1], scale), mat, x, y, z, rot, warp);
  }

  box({ sx, sy, sz, x = 0, y = 0, z = 0, mat, rot, bevel, bevel_segments, warp }: BoxOpts): void {
    this.add(geo.box(sx, sy, sz, bevel ?? this.knobs.bevel, bevel_segments ?? this.knobs.bevelSegments), mat, x, y, z, rot, warp);
  }

  torus({ R, r, x = 0, y = 0, z = 0, mat, rot, segments, minor = 10, warp }: TorusOpts): void {
    this.add(geo.torus(R, r, segments ?? this.knobs.segments, minor), mat, x, y, z, rot, warp);
  }

  tube({ points, r, mat, segments = 12, smooth = false, warp }: TubeOpts): void {
    this.add(geo.tube(points, r, segments, smooth), mat, 0, 0, 0, undefined, warp);
  }

  blob({ balls, mat, resolution = 24, blend = 0.3, warp }: BlobOpts): void {
    this.add(geo.blob(balls, resolution, blend), mat, 0, 0, 0, undefined, warp);
  }

  lathe({ profile, x = 0, y = 0, z = 0, mat, rot, bevel, segments, bevel_segments, warp }: LatheOpts): void {
    const closed = geo.closeProfile(profile);
    this.add(geo.lathe(geo.roundedProfile(closed, bevel ?? this.knobs.bevel, bevel_segments ?? this.knobs.bevelSegments), segments ?? this.knobs.segments), mat, x, y, z, rot, warp);
  }

  extrude({ outline, holes = [], depth, smooth, x = 0, y = 0, z = 0, mat, rot, bevel, bevel_segments, warp }: ExtrudeOpts): void {
    this.add(geo.extrude(outline, holes, depth, bevel ?? this.knobs.bevel, bevel_segments ?? this.knobs.bevelSegments, smooth), mat, x, y, z, rot, warp);
  }

  loft({ sections, mat, segments, smooth, caps = true, warp }: LoftOpts): void {
    this.add(geo.loft(sections, segments ?? this.knobs.segments, smooth, caps), mat, 0, 0, 0, undefined, warp);
  }

  hull({ points, mat, warp }: HullOpts): void {
    this.add(geo.hull(points), mat, 0, 0, 0, undefined, warp);
  }

  mesh({ geometry, x = 0, y = 0, z = 0, mat, rot, warp }: MeshOpts): void {
    if (!(geometry as BufferGeometry)?.isBufferGeometry) throw new Error("mesh() takes a three.js BufferGeometry, e.g. new kit.three.IcosahedronGeometry(0.2)");

    this.add((geometry as BufferGeometry).clone(), mat, x, y, z, rot, warp);
  }

  cut({ from, away }: CutOpts): void {
    this.current.shapes.push(...boolean(this.collect(from), this.collect(away), "subtract"));
  }

  intersect({ a, b }: IntersectOpts): void {
    this.current.shapes.push(...boolean(this.collect(a), this.collect(b), "intersect"));
  }

  part({ name, pivot = [0, 0, 0] }: PartOpts, build: (kit: KitApi) => void): void {
    this.claim(name);
    const node: PartNode = { name, pivot, shapes: [], children: [], markers: [] };
    this.current.children.push(node);
    const saved = this.current;
    this.current = node;

    try {
      build(this);
    } finally {
      this.current = saved;
    }
  }

  marker({ name, x = 0, y = 0, z = 0, rot = [0, 0, 0] }: MarkerOpts): void {
    this.claim(name);
    this.current.markers.push({ name, at: [x, y, z], rot });
  }

  clip({ name, duration, fps = 30 }: ClipOpts, tracks: Record<string, Track>): void {
    if (!name) throw new Error("a clip needs a name");

    if (this.clips.some((c) => c.name === name)) throw new Error(`clip "${name}" is defined twice`);

    if (!(duration > 0)) throw new Error(`clip "${name}" needs a duration above 0 seconds`);

    if (!(fps > 0)) throw new Error(`clip "${name}" needs fps above 0`);

    this.clips.push({ name, duration, fps, tracks });
  }

  bend({ angle, toward = "x", detail }: { angle: number; toward?: "x" | "-x" | "y" | "-y"; detail?: number }): Warp {
    return { fn: geo.bendWarp(angle, toward), detail };
  }

  twist({ angle, detail }: { angle: number; detail?: number }): Warp {
    return { fn: geo.twistWarp(angle), detail };
  }

  // A taper is linear along z, so it needs no extra vertices unless asked.
  taper({ top, bottom = 1, detail = Infinity }: { top: number; bottom?: number; detail?: number }): Warp {
    return { fn: geo.taperWarp(top, bottom), detail };
  }

  noise({ amount, size, seed = 1, detail }: { amount: number; size?: number; seed?: number; detail?: number }): Warp {
    return { fn: geo.noiseWarp(amount, size, seed), detail };
  }
}

export type AssembledPart = { name: string; pivot: Vec3; parentPivot: Vec3; geometry: BufferGeometry | null; children: AssembledPart[]; markers: Marker[] };
export type Assembled = { root: AssembledPart; materials: string[]; stats: BuildStats };

function mergeShapes(shapes: Shape[], materials: string[], smoothAngle: number): BufferGeometry {
  const ordered = [...shapes].sort((a, b) => materials.indexOf(a.mat) - materials.indexOf(b.mat));
  const bare = ordered.map((p) => {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();

    for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name);

    g.clearGroups();

    return g;
  });
  const merged = mergeGeometries(bare, true);

  if (!merged) throw new Error("the shapes could not be merged");

  const groups: { start: number; count: number; materialIndex: number }[] = [];
  merged.groups.forEach((g, i) => {
    const materialIndex = materials.indexOf(ordered[i].mat);
    const last = groups[groups.length - 1];

    if (last && last.materialIndex === materialIndex) last.count += g.count;
    else groups.push({ start: g.start, count: g.count, materialIndex });
  });

  merged.clearGroups();

  for (const g of groups) merged.addGroup(g.start, g.count, g.materialIndex);

  return shade(merged, smoothAngle);
}

export function assemble(kit: Kit, smoothAngle?: number): Assembled {
  const nodes: PartNode[] = [];
  const gather = (node: PartNode) => {
    nodes.push(node);
    node.children.forEach(gather);
  };
  gather(kit.root);

  if (nodes.every((n) => n.shapes.length === 0)) throw new Error("the recipe built nothing");

  const materials = [...new Set(nodes.flatMap((n) => n.shapes.map((s) => s.mat)))];
  // Flat shading is the same rule with no slack: only coplanar faces share.
  const angle = kit.knobs.smooth ? (smoothAngle ?? kit.knobs.smoothAngle) : 0.5;
  const box = new Box3();
  let tris = 0;
  let verts = 0;
  const walk = (node: PartNode, parentPivot: Vec3): AssembledPart => {
    const geometry = node.shapes.length ? mergeShapes(node.shapes, materials, angle) : null;

    if (geometry) {
      tris += (geometry.index?.count ?? 0) / 3;
      verts += geometry.attributes.position.count;
      geometry.computeBoundingBox();
      box.union(geometry.boundingBox!);
    }

    return { name: node.name, pivot: node.pivot, parentPivot, geometry, children: node.children.map((c) => walk(c, node.pivot)), markers: node.markers };
  };
  const root = walk(kit.root, [0, 0, 0]);
  const stats: BuildStats = {
    tris,
    verts,
    materials,
    min: [round(box.min.x), round(box.min.y), round(box.min.z)],
    max: [round(box.max.x), round(box.max.y), round(box.max.z)],
    parts: nodes.slice(1).map((n) => n.name),
    markers: nodes.flatMap((n) => n.markers.map((m) => m.name)),
    clips: kit.clips.map((c) => ({ name: c.name, duration: c.duration })),
  };

  return { root, materials, stats };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
