// The object a recipe's build() receives, and the assembly of its parts into
// one mesh: material groups, creased or flat normals, shared vertices.
import { BufferGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import * as geo from "./geometry.ts";
import { shade } from "./shade.ts";
import type { BlobOpts, BoxOpts, BuildStats, ConeOpts, CylinderOpts, Kit as KitApi, Knobs, LatheOpts, MaterialSpec, SphereOpts, TorusOpts, TubeOpts, Vec3 } from "./types.ts";

type Part = { geometry: BufferGeometry; mat: string };

export class Kit implements KitApi {
  readonly parts: Part[] = [];
  readonly knobs: Knobs;
  readonly materials: Record<string, MaterialSpec>;

  constructor(knobs: Knobs, materials: Record<string, MaterialSpec>) {
    this.knobs = knobs;
    this.materials = materials;
  }

  private add(geometry: BufferGeometry, mat: string | undefined, x = 0, y = 0, z = 0, rot?: Vec3): void {
    const name = mat ?? "base";

    if (!this.materials[name]) {
      throw new Error(`material "${name}" is not in the style's palette (${Object.keys(this.materials).sort().join(", ") || "empty"})`);
    }

    geometry.applyMatrix4(geo.placement(x, y, z, rot));
    this.parts.push({ geometry, mat: name });
  }

  cylinder({ r, h, x = 0, y = 0, z = 0, mat, rot, bevel, segments, bevel_segments }: CylinderOpts): void {
    this.add(geo.cylinder(r, h, bevel ?? this.knobs.bevel, segments ?? this.knobs.segments, bevel_segments ?? this.knobs.bevelSegments), mat, x, y, z + h / 2, rot);
  }

  cone({ r1, r2, h, x = 0, y = 0, z = 0, mat, rot, bevel, segments, bevel_segments }: ConeOpts): void {
    this.add(geo.cone(r1, Math.max(r2, 0), h, bevel ?? this.knobs.bevel, segments ?? this.knobs.segments, bevel_segments ?? this.knobs.bevelSegments), mat, x, y, z + h / 2, rot);
  }

  sphere({ r, x = 0, y = 0, z = 0, mat, u, v, scale = [1, 1, 1] }: SphereOpts): void {
    this.add(geo.sphere(r, u ?? this.knobs.sphere[0], v ?? this.knobs.sphere[1], scale), mat, x, y, z);
  }

  box({ sx, sy, sz, x = 0, y = 0, z = 0, mat, rot, bevel, bevel_segments }: BoxOpts): void {
    this.add(geo.box(sx, sy, sz, bevel ?? this.knobs.bevel, bevel_segments ?? this.knobs.bevelSegments), mat, x, y, z, rot);
  }

  torus({ R, r, x = 0, y = 0, z = 0, mat, rot, segments, minor = 10 }: TorusOpts): void {
    this.add(geo.torus(R, r, segments ?? this.knobs.segments, minor), mat, x, y, z, rot);
  }

  tube({ points, r, mat, segments = 12, smooth = false }: TubeOpts): void {
    this.add(geo.tube(points, r, segments, smooth), mat);
  }

  blob({ balls, mat, resolution = 24, blend = 0.3 }: BlobOpts): void {
    this.add(geo.blob(balls, resolution, blend), mat);
  }

  lathe({ profile, x = 0, y = 0, z = 0, mat, rot, bevel, segments, bevel_segments }: LatheOpts): void {
    const closed = geo.closeProfile(profile);
    this.add(geo.lathe(geo.roundedProfile(closed, bevel ?? this.knobs.bevel, bevel_segments ?? this.knobs.bevelSegments), segments ?? this.knobs.segments), mat, x, y, z, rot);
  }
}

export type Assembled = { geometry: BufferGeometry; materials: string[]; stats: BuildStats };

export function assemble(kit: Kit, smoothAngle?: number): Assembled {
  if (kit.parts.length === 0) throw new Error("the recipe built nothing");

  const materials = [...new Set(kit.parts.map((p) => p.mat))];
  const ordered = [...kit.parts].sort((a, b) => materials.indexOf(a.mat) - materials.indexOf(b.mat));
  const bare = ordered.map((p) => {
    const g = p.geometry.toNonIndexed();

    for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name);

    g.clearGroups();

    return g;
  });
  const merged = mergeGeometries(bare, true);

  if (!merged) throw new Error("the parts could not be merged");

  const groups: { start: number; count: number; materialIndex: number }[] = [];
  merged.groups.forEach((g, i) => {
    const materialIndex = materials.indexOf(ordered[i].mat);
    const last = groups[groups.length - 1];

    if (last && last.materialIndex === materialIndex) last.count += g.count;
    else groups.push({ start: g.start, count: g.count, materialIndex });
  });

  merged.clearGroups();

  for (const g of groups) merged.addGroup(g.start, g.count, g.materialIndex);

  // Flat shading is the same rule with no slack: only coplanar faces share.
  const indexed = shade(merged, kit.knobs.smooth ? (smoothAngle ?? kit.knobs.smoothAngle) : 0.5);
  indexed.computeBoundingBox();
  const bb = indexed.boundingBox!;
  const stats: BuildStats = {
    tris: (indexed.index?.count ?? 0) / 3,
    verts: indexed.attributes.position.count,
    materials,
    min: [round(bb.min.x), round(bb.min.y), round(bb.min.z)],
    max: [round(bb.max.x), round(bb.max.y), round(bb.max.z)],
  };

  return { geometry: indexed, materials, stats };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
