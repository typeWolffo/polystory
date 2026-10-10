// Primitives in recipe space: +Z up, -Y forward. Every function returns an
// indexed BufferGeometry already placed; normals and uvs are thrown away at
// assembly and recomputed from the faces, so only positions matter here.
import { BoxGeometry, BufferAttribute, BufferGeometry, CatmullRomCurve3, Matrix4, SphereGeometry, TorusGeometry, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { edgeTable, triTable } from "three/examples/jsm/objects/MarchingCubes.js";

import type { Vec3 } from "./types.ts";

const rad = (deg: number) => (deg * Math.PI) / 180;

export function placement(x: number, y: number, z: number, rot: Vec3 = [0, 0, 0]): Matrix4 {
  const [rx, ry, rz] = rot.map(rad);

  return new Matrix4()
    .makeTranslation(x, y, z)
    .multiply(new Matrix4().makeRotationZ(rz))
    .multiply(new Matrix4().makeRotationY(ry))
    .multiply(new Matrix4().makeRotationX(rx));
}

type Point2 = [number, number];

// Rounds every interior corner of a (radius, height) profile with a circular
// arc tangent to both edges `bevel` away from the corner, the way a mesh
// bevel of the same offset would; clamped so two arcs never overlap.
export function roundedProfile(points: Point2[], bevel: number, segments: number): Point2[] {
  if (bevel <= 0 || segments <= 0) return points;

  const out: Point2[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i + 1];
    const l1 = Math.hypot(px - ax, py - ay);
    const l2 = Math.hypot(bx - px, by - py);
    const d1: Point2 = [(px - ax) / l1, (py - ay) / l1];
    const d2: Point2 = [(bx - px) / l2, (by - py) / l2];
    const cross = d1[0] * d2[1] - d1[1] * d2[0];
    const dot = d1[0] * d2[0] + d1[1] * d2[1];
    const turn = Math.atan2(cross, dot);

    if (Math.abs(turn) < 1e-6 || points[i][0] <= 0) {
      out.push(points[i]);
      continue;
    }

    const t = Math.min(bevel, l1 / 2 - 1e-6, l2 / 2 - 1e-6);
    const r = t * Math.tan((Math.PI - Math.abs(turn)) / 2);
    const side = Math.sign(cross);
    const a: Point2 = [px - d1[0] * t, py - d1[1] * t];
    const b: Point2 = [px + d2[0] * t, py + d2[1] * t];
    const c: Point2 = [a[0] - d1[1] * r * side, a[1] + d1[0] * r * side];
    const start = Math.atan2(a[1] - c[1], a[0] - c[0]);
    const end = Math.atan2(b[1] - c[1], b[0] - c[0]);
    let sweep = end - start;

    while (sweep > Math.PI) sweep -= 2 * Math.PI;

    while (sweep < -Math.PI) sweep += 2 * Math.PI;

    for (let k = 0; k <= segments; k++) {
      const ang = start + (sweep * k) / segments;
      out.push([Math.max(0, c[0] + r * Math.cos(ang)), c[1] + r * Math.sin(ang)]);
    }
  }

  out.push(points[points.length - 1]);

  return out;
}

// A free profile from a recipe: bottom to top, closed on the axis at both
// ends, so a recipe lists only the outline it cares about.
export function closeProfile(profile: Point2[]): Point2[] {
  if (profile.length < 2) throw new Error("a lathe profile needs at least two points");

  const points = profile[0][1] <= profile[profile.length - 1][1] ? [...profile] : [...profile].reverse();

  if (points[0][0] > 1e-9) points.unshift([0, points[0][1]]);

  if (points[points.length - 1][0] > 1e-9) points.push([0, points[points.length - 1][1]]);

  return points;
}

// Revolves a profile around +Z. The profile starts on the axis at the bottom,
// runs out and up, and ends on the axis at the top; those two axis points
// become the caps.
export function lathe(profile: Point2[], segments: number): BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  const rings: (number[] | number)[] = [];

  for (const [rho, z] of profile) {
    if (rho <= 1e-9) {
      rings.push(positions.length / 3);
      positions.push(0, 0, z);
      continue;
    }

    const ring: number[] = [];

    for (let i = 0; i < segments; i++) {
      const a = (2 * Math.PI * i) / segments;
      ring.push(positions.length / 3);
      positions.push(rho * Math.cos(a), rho * Math.sin(a), z);
    }

    rings.push(ring);
  }

  for (let k = 0; k < rings.length - 1; k++) {
    const lower = rings[k];
    const upper = rings[k + 1];

    if (Array.isArray(lower) && Array.isArray(upper)) {
      for (let i = 0; i < segments; i++) {
        const j = (i + 1) % segments;
        index.push(lower[i], lower[j], upper[j], lower[i], upper[j], upper[i]);
      }
    } else if (!Array.isArray(lower) && Array.isArray(upper)) {
      for (let i = 0; i < segments; i++) index.push(lower, upper[(i + 1) % segments], upper[i]);
    } else if (Array.isArray(lower) && !Array.isArray(upper)) {
      for (let i = 0; i < segments; i++) index.push(upper, lower[i], lower[(i + 1) % segments]);
    } else {
      throw new Error("a lathe profile cannot have two axis points in a row");
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(index);

  return geometry;
}

export function cylinder(r: number, h: number, bevel: number, segments: number, bevelSegments: number): BufferGeometry {
  return lathe(roundedProfile([[0, -h / 2], [r, -h / 2], [r, h / 2], [0, h / 2]], bevel, bevelSegments), segments);
}

export function cone(r1: number, r2: number, h: number, bevel: number, segments: number, bevelSegments: number): BufferGeometry {
  const profile: Point2[] = r2 > 1e-9 ? [[0, -h / 2], [r1, -h / 2], [r2, h / 2], [0, h / 2]] : [[0, -h / 2], [r1, -h / 2], [0, h / 2]];

  return lathe(roundedProfile(profile, bevel, bevelSegments), segments);
}

export function sphere(r: number, u: number, v: number, scale: Vec3): BufferGeometry {
  const g = new SphereGeometry(r, u, v);
  g.rotateX(Math.PI / 2);
  g.scale(...scale);

  return g;
}

export function box(sx: number, sy: number, sz: number, bevel: number, bevelSegments: number): BufferGeometry {
  if (bevel <= 0 || bevelSegments <= 0) return new BoxGeometry(sx, sy, sz);

  const b = Math.min(bevel, sx / 2 - 1e-6, sy / 2 - 1e-6, sz / 2 - 1e-6);

  return new RoundedBoxGeometry(sx, sy, sz, bevelSegments, b);
}

export function torus(R: number, r: number, segments: number, minor: number): BufferGeometry {
  return new TorusGeometry(R, r, minor, segments);
}

// A tube along a polyline with rotation-minimising frames, capped at both
// ends; straps, stems, wires and fuses. `smooth` runs a Catmull-Rom curve
// through the points instead of straight runs, sampled `smooth` times
// per span (true: 6).
export function tube(points: Vec3[], r: number, segments: number, smooth: boolean | number = false): BufferGeometry {
  const control = points.map((p) => new Vector3(...p));
  const perSpan = smooth === true ? 6 : smooth || 0;
  const pts = perSpan > 0 && control.length > 2 ? new CatmullRomCurve3(control, false, "centripetal").getPoints((control.length - 1) * perSpan) : control;
  const tangents = pts.map((_, i) => {
    const axis = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]);

    return axis.length() > 1e-9 ? axis.normalize() : new Vector3(0, 0, 1);
  });
  const helper = Math.abs(tangents[0].z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  let normal = tangents[0].clone().cross(helper).normalize();
  const positions: number[] = [];
  const index: number[] = [];
  const rings: number[][] = [];

  pts.forEach((p, i) => {
    const t = tangents[i];

    if (i > 0) {
      const swing = tangents[i - 1].clone().cross(t);

      if (swing.length() > 1e-9) normal.applyAxisAngle(swing.normalize(), tangents[i - 1].angleTo(t));

      normal = normal.sub(t.clone().multiplyScalar(normal.dot(t))).normalize();
    }

    const binormal = t.clone().cross(normal);
    const ring: number[] = [];

    for (let j = 0; j < segments; j++) {
      const b = (2 * Math.PI * j) / segments;
      ring.push(positions.length / 3);
      const v = p.clone().addScaledVector(normal, r * Math.cos(b)).addScaledVector(binormal, r * Math.sin(b));
      positions.push(v.x, v.y, v.z);
    }

    rings.push(ring);
  });

  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const k = (j + 1) % segments;
      index.push(rings[i][j], rings[i][k], rings[i + 1][k], rings[i][j], rings[i + 1][k], rings[i + 1][j]);
    }
  }

  const first = positions.length / 3;
  positions.push(pts[0].x, pts[0].y, pts[0].z);
  const last = positions.length / 3;
  const end = pts[pts.length - 1];
  positions.push(end.x, end.y, end.z);

  for (let j = 0; j < segments; j++) {
    const k = (j + 1) % segments;
    index.push(first, rings[0][k], rings[0][j]);
    index.push(last, rings[rings.length - 1][j], rings[rings.length - 1][k]);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(index);

  return geometry;
}

export type Ball = [number, number, number, number];

// Metaballs: every ball adds a Wyvill falloff (1 - d²/R²)³ inside its reach
// R, and the surface is where the sum crosses the threshold, which is the
// blend. R is picked so a ball on its own shows its radius r; the higher
// the blend, the further R reaches past r and the more neighbours melt:
// 0.1 keeps puffs apart with a soft seam, 0.3 is goo, 0.5 one smooth mass.
const reachFor = (blend: number) => 1 / Math.sqrt(1 - Math.cbrt(blend));
// @types/three types the tables as arrays of arrays; they are flat.
const EDGE_TABLE = edgeTable as unknown as Int32Array;
const TRI_TABLE = triTable as unknown as Int32Array;
const CORNERS: Point3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const EDGES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

type Point3 = [number, number, number];

export function blob(balls: Ball[], resolution: number, blend = 0.3): BufferGeometry {
  if (balls.length === 0) throw new Error("a blob needs at least one ball");

  if (!(blend > 0.01 && blend < 0.9)) throw new Error(`blob blend ${blend} is outside 0.01..0.9`);

  const THRESHOLD = blend;
  const REACH = reachFor(blend);

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];

  for (const [x, y, z, r] of balls) {
    const R = r * REACH;
    [x, y, z].forEach((c, i) => {
      lo[i] = Math.min(lo[i], c - R);
      hi[i] = Math.max(hi[i], c + R);
    });
  }

  const cell = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / resolution;
  const n = lo.map((l, i) => Math.ceil((hi[i] - l) / cell) + 3);
  const at = (i: number, j: number, k: number) => i + n[0] * (j + n[1] * k);
  const pos = (i: number, j: number, k: number): Point3 => [lo[0] + (i - 1) * cell, lo[1] + (j - 1) * cell, lo[2] + (k - 1) * cell];
  const field = new Float32Array(n[0] * n[1] * n[2]);

  for (const [x, y, z, r] of balls) {
    const R = r * REACH;
    const from = [x, y, z].map((c, i) => Math.max(0, Math.floor((c - R - lo[i]) / cell)));
    const to = [x, y, z].map((c, i) => Math.min(n[i] - 1, Math.ceil((c + R - lo[i]) / cell) + 2));

    for (let k = from[2]; k <= to[2]; k++) {
      for (let j = from[1]; j <= to[1]; j++) {
        for (let i = from[0]; i <= to[0]; i++) {
          const [px, py, pz] = pos(i, j, k);
          const d2 = ((px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2) / (R * R);

          if (d2 < 1) field[at(i, j, k)] += (1 - d2) ** 3;
        }
      }
    }
  }

  const positions: number[] = [];
  const index: number[] = [];
  const shared = new Map<number, number>();
  const total = field.length;

  const vertexOn = (a: number, b: number, pa: Point3, pb: Point3): number => {
    const key = a < b ? a * total + b : b * total + a;
    const known = shared.get(key);

    if (known !== undefined) return known;

    const va = field[a];
    const vb = field[b];
    const t = Math.abs(vb - va) < 1e-12 ? 0.5 : (THRESHOLD - va) / (vb - va);
    const id = positions.length / 3;
    positions.push(pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1]), pa[2] + t * (pb[2] - pa[2]));
    shared.set(key, id);

    return id;
  };

  for (let k = 0; k < n[2] - 1; k++) {
    for (let j = 0; j < n[1] - 1; j++) {
      for (let i = 0; i < n[0] - 1; i++) {
        const ids = CORNERS.map(([dx, dy, dz]) => at(i + dx, j + dy, k + dz));
        let cube = 0;

        ids.forEach((id, c) => {
          if (field[id] < THRESHOLD) cube |= 1 << c;
        });

        if (EDGE_TABLE[cube] === 0) continue;

        const verts: number[] = [];
        EDGES.forEach(([ca, cb], e) => {
          if (EDGE_TABLE[cube] & (1 << e)) {
            const [ax, ay, az] = CORNERS[ca];
            const [bx, by, bz] = CORNERS[cb];
            verts[e] = vertexOn(ids[ca], ids[cb], pos(i + ax, j + ay, k + az), pos(i + bx, j + by, k + bz));
          }
        });

        for (let t = cube * 16; TRI_TABLE[t] !== -1; t += 3) {
          const a = verts[TRI_TABLE[t]];
          const b = verts[TRI_TABLE[t + 1]];
          const c = verts[TRI_TABLE[t + 2]];

          if (a !== b && b !== c && a !== c) index.push(a, b, c);
        }
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(index);

  return geometry;
}
