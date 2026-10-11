// Primitives in recipe space: +Z up, -Y forward. Every function returns an
// indexed BufferGeometry already placed; normals and uvs are thrown away at
// assembly and recomputed from the faces, so only positions matter here.
import { BoxGeometry, BufferAttribute, BufferGeometry, CatmullRomCurve3, ExtrudeGeometry, Matrix4, Path, Shape, SphereGeometry, TorusGeometry, Vector2, Vector3 } from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import { edgeTable, triTable } from "three/examples/jsm/objects/MarchingCubes.js";

import type { LoftSection, Vec3, Warp } from "./types.ts";

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

const perSpanOf = (smooth: boolean | number | undefined) => (smooth === true ? 6 : smooth || 0);

// A closed Catmull-Rom loop through the points, the duplicate end dropped.
function smoothLoop(points: Point2[], perSpan: number): Point2[] {
  if (perSpan <= 0 || points.length < 3) return points;

  const curve = new CatmullRomCurve3(points.map(([u, v]) => new Vector3(u, v, 0)), true, "centripetal");

  return curve.getPoints(points.length * perSpan).slice(0, -1).map((p) => [p.x, p.y] as Point2);
}

// An outline drawn as seen from the front (x right, z up), given `depth`
// along y and centred on it. The bevel is cut inside the outline, so the
// outline stays the silhouette.
export function extrude(outline: Point2[], holes: Point2[][], depth: number, bevel: number, bevelSegments: number, smooth?: boolean | number): BufferGeometry {
  if (outline.length < 3) throw new Error("an extrude outline needs at least three points");

  const perSpan = perSpanOf(smooth);
  const shape = new Shape(smoothLoop(outline, perSpan).map(([u, v]) => new Vector2(u, v)));

  for (const hole of holes) shape.holes.push(new Path(smoothLoop(hole, perSpan).map(([u, v]) => new Vector2(u, v))));

  const b = bevelSegments > 0 ? Math.max(0, Math.min(bevel, depth / 2 - 1e-4)) : 0;
  const core = Math.max(depth - 2 * b, 1e-4);
  const g = new ExtrudeGeometry(shape, { depth: core, steps: 1, curveSegments: 1, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments });
  g.translate(0, 0, -core / 2);
  g.rotateX(Math.PI / 2);

  return g;
}

function signedArea(points: Point2[]): number {
  let area = 0;

  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    area += ax * by - bx * ay;
  }

  return area / 2;
}

// `count` points spread evenly along a closed outline from its first point,
// counter-clockwise, so every section of a loft lines up with the next.
function resample(points: Point2[], count: number): Point2[] {
  const loop = signedArea(points) < 0 ? [points[0], ...points.slice(1).reverse()] : points;
  const lengths = loop.map((p, i) => Math.hypot(loop[(i + 1) % loop.length][0] - p[0], loop[(i + 1) % loop.length][1] - p[1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  const out: Point2[] = [];
  let edge = 0;
  let walked = 0;

  for (let k = 0; k < count; k++) {
    const want = (total * k) / count;

    while (walked + lengths[edge] < want && edge < loop.length - 1) {
      walked += lengths[edge];
      edge++;
    }

    const f = lengths[edge] > 1e-12 ? (want - walked) / lengths[edge] : 0;
    const [ax, ay] = loop[edge];
    const [bx, by] = loop[(edge + 1) % loop.length];
    out.push([ax + (bx - ax) * f, ay + (by - ay) * f]);
  }

  return out;
}

function sectionRing(section: LoftSection, count: number): Point2[] {
  let ring: Point2[];

  if (section.shape) ring = resample(section.shape, count);
  else {
    const [w, h] = section.size ?? [(section.r ?? 0) * 2, (section.r ?? 0) * 2];

    if (!(w > 0 && h > 0)) throw new Error("a loft section needs r, size or shape");

    ring = Array.from({ length: count }, (_, k) => [(w / 2) * Math.cos((2 * Math.PI * k) / count), (h / 2) * Math.sin((2 * Math.PI * k) / count)] as Point2);
  }

  const turn = ((section.turn ?? 0) * Math.PI) / 180;

  return turn ? ring.map(([u, v]) => [u * Math.cos(turn) - v * Math.sin(turn), u * Math.sin(turn) + v * Math.cos(turn)] as Point2) : ring;
}

// A skin through cross-sections set across a spine: each section's u axis
// points right of the spine and v up (+Z, or -Y where the spine is vertical),
// carried along by rotation-minimising frames so the skin never twists by
// itself. `smooth` runs a curve through matching points of the sections.
export function loft(sections: LoftSection[], segments: number, smooth?: boolean | number, caps = true): BufferGeometry {
  if (sections.length < 2) throw new Error("a loft needs at least two sections");

  const centres = sections.map((s) => new Vector3(...s.at));
  const tangents = centres.map((_, i) => {
    const t = centres[Math.min(i + 1, centres.length - 1)].clone().sub(centres[Math.max(i - 1, 0)]);

    return t.length() > 1e-9 ? t.normalize() : new Vector3(0, -1, 0);
  });
  const up0 = Math.abs(tangents[0].z) < 0.99 ? new Vector3(0, 0, 1) : new Vector3(0, -1, 0);
  let v = up0.sub(tangents[0].clone().multiplyScalar(up0.dot(tangents[0]))).normalize();
  const rings: Vector3[][] = [];

  sections.forEach((section, i) => {
    const t = tangents[i];

    if (i > 0) {
      const swing = tangents[i - 1].clone().cross(t);

      if (swing.length() > 1e-9) v.applyAxisAngle(swing.normalize(), tangents[i - 1].angleTo(t));

      v = v.sub(t.clone().multiplyScalar(v.dot(t))).normalize();
    }

    const u = v.clone().cross(t);
    rings.push(sectionRing(section, segments).map(([a, b]) => centres[i].clone().addScaledVector(u, a).addScaledVector(v, b)));
  });

  const perSpan = perSpanOf(smooth);
  const columns = perSpan > 0 && rings.length > 2
    ? Array.from({ length: segments }, (_, j) => new CatmullRomCurve3(rings.map((r) => r[j]), false, "centripetal").getPoints((rings.length - 1) * perSpan))
    : Array.from({ length: segments }, (_, j) => rings.map((r) => r[j]));
  const steps = columns[0].length;
  const positions: number[] = [];
  const index: number[] = [];
  const at = (i: number, j: number) => i * segments + j;

  for (let i = 0; i < steps; i++) for (let j = 0; j < segments; j++) positions.push(columns[j][i].x, columns[j][i].y, columns[j][i].z);

  for (let i = 0; i < steps - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const k = (j + 1) % segments;
      index.push(at(i, j), at(i, k), at(i + 1, k), at(i, j), at(i + 1, k), at(i + 1, j));
    }
  }

  if (caps) {
    for (const [i, flip] of [[0, true], [steps - 1, false]] as const) {
      const centre = new Vector3();

      for (let j = 0; j < segments; j++) centre.add(columns[j][i]);

      centre.divideScalar(segments);
      const c = positions.length / 3;
      positions.push(centre.x, centre.y, centre.z);

      for (let j = 0; j < segments; j++) {
        const k = (j + 1) % segments;
        index.push(...(flip ? [c, at(i, k), at(i, j)] : [c, at(i, j), at(i, k)]));
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(index);

  return geometry;
}

export function hull(points: Vec3[]): BufferGeometry {
  if (points.length < 4) throw new Error("a hull needs at least four points");

  return new ConvexGeometry(points.map((p) => new Vector3(...p)));
}

const DIRECTIONS: Record<string, [number, number]> = { x: [1, 0], "-x": [-1, 0], y: [0, 1], "-y": [0, -1] };

export function bendWarp(angle: number, toward: string = "x"): Warp["fn"] {
  const theta = (angle * Math.PI) / 180;
  const [dx, dy] = DIRECTIONS[toward] ?? DIRECTIONS.x;

  return ([x, y, z], _t, box) => {
    const length = box.max[2] - box.min[2];

    if (Math.abs(theta) < 1e-6 || length < 1e-9) return [x, y, z];

    // The part's own z axis becomes an arc of radius R toward `toward`.
    const R = length / theta;
    const w = x * dx + y * dy;
    const q = -x * dy + y * dx;
    const phi = (theta * (z - box.min[2])) / length;
    const w2 = R - (R - w) * Math.cos(phi);

    return [w2 * dx - q * dy, w2 * dy + q * dx, box.min[2] + (R - w) * Math.sin(phi)];
  };
}

export function twistWarp(angle: number): Warp["fn"] {
  const theta = (angle * Math.PI) / 180;

  return ([x, y, z], t) => {
    const phi = theta * t;

    return [x * Math.cos(phi) - y * Math.sin(phi), x * Math.sin(phi) + y * Math.cos(phi), z];
  };
}

export function taperWarp(top: number, bottom = 1): Warp["fn"] {
  return ([x, y, z], t) => {
    const s = bottom + (top - bottom) * t;

    return [x * s, y * s, z];
  };
}

function hash(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;

  return ((h >>> 0) / 4294967295) * 2 - 1;
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fade = (f: number) => f * f * (3 - 2 * f);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
  const at = (a: number, b: number, c: number) => hash(ix + a, iy + b, iz + c, seed);

  return lerp(
    lerp(lerp(at(0, 0, 0), at(1, 0, 0), fx), lerp(at(0, 1, 0), at(1, 1, 0), fx), fy),
    lerp(lerp(at(0, 0, 1), at(1, 0, 1), fx), lerp(at(0, 1, 1), at(1, 1, 1), fx), fy),
    fz,
  );
}

export function noiseWarp(amount: number, size?: number, seed = 1): Warp["fn"] {
  return ([x, y, z], _t, box) => {
    const cell = size ?? Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2], 1e-6) / 4;
    const [u, v, w] = [x / cell, y / cell, z / cell];

    return [x + amount * valueNoise(u, v, w, seed), y + amount * valueNoise(u, v, w, seed + 17), z + amount * valueNoise(u, v, w, seed + 31)];
  };
}

// Splits triangles until no edge is longer than the finest warp's detail
// (by default an eighth of the part), so a bend has vertices to bend.
export function applyWarps(geometry: BufferGeometry, warps: Warp[]): BufferGeometry {
  if (warps.length === 0) return geometry;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const box = { min: [bb.min.x, bb.min.y, bb.min.z] as Vec3, max: [bb.max.x, bb.max.y, bb.max.z] as Vec3 };
  const extent = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z, 1e-6);
  const detail = Math.min(...warps.map((w) => w.detail ?? extent / 8));
  const bare = geometry.index ? geometry.toNonIndexed() : geometry.clone();

  for (const name of Object.keys(bare.attributes)) if (name !== "position") bare.deleteAttribute(name);

  const fine = new TessellateModifier(detail, 16).modify(bare);
  const pos = fine.attributes.position.array as Float32Array;
  const span = Math.max(box.max[2] - box.min[2], 1e-9);

  for (let i = 0; i < pos.length; i += 3) {
    let p: Vec3 = [pos[i], pos[i + 1], pos[i + 2]];
    const t = (p[2] - box.min[2]) / span;

    for (const w of warps) p = w.fn(p, t, box);

    pos.set(p, i);
  }

  return fine;
}
