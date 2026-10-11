// Booleans on shapes through three-bvh-csg. Each face keeps the material of
// the shape it came from, so the inside of a hole wears the cutter's colour.
import { BufferAttribute, BufferGeometry, MeshBasicMaterial } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg";

import type { Shape } from "./kit.ts";

function brush(shapes: Shape[], names: string[], materials: MeshBasicMaterial[]): Brush {
  const bare = shapes.map((s) => {
    const g = s.geometry.index ? s.geometry.toNonIndexed() : s.geometry.clone();

    for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name);

    g.clearGroups();

    return g;
  });
  const merged = mergeGeometries(bare, true);

  if (!merged) throw new Error("the shapes of a cut could not be merged");

  merged.groups.forEach((g, i) => {
    g.materialIndex = names.indexOf(shapes[i].mat);
  });
  const out = new Brush(merged, materials);
  out.updateMatrixWorld();

  return out;
}

// A boolean leaves T-junctions: a vertex of one face sits in the middle of
// a neighbour's edge, and the renderer shows the background through the
// hairline gap as dark specks. Every face with vertices on its edges is
// split into a fan around its centroid that passes through them.
function closeTJunctions(pos: Float32Array, material: number[]): { pos: Float32Array; material: number[] } {
  const faces = pos.length / 9;
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < pos.length; i += 3) {
    lo = lo.map((v, k) => Math.min(v, pos[i + k]));
    hi = hi.map((v, k) => Math.max(v, pos[i + k]));
  }

  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const tol = diag * 2e-6;
  const cell = diag / 128;
  const unique = new Map<string, [number, number, number]>();

  for (let i = 0; i < pos.length; i += 3) unique.set(`${Math.round(pos[i] / tol)},${Math.round(pos[i + 1] / tol)},${Math.round(pos[i + 2] / tol)}`, [pos[i], pos[i + 1], pos[i + 2]]);

  const points = [...unique.values()];
  const grid = new Map<string, number[]>();
  const cellOf = (p: number[]) => p.map((v) => Math.floor(v / cell));

  points.forEach((p, i) => {
    const key = cellOf(p).join(",");
    const list = grid.get(key);

    if (list) list.push(i);
    else grid.set(key, [i]);
  });

  const near = (p: number[], q: number[]): number[] => {
    const found = new Set<number>();
    const steps = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / cell));

    for (let s = 0; s <= steps; s++) {
      const [cx, cy, cz] = cellOf(p.map((v, k) => v + ((q[k] - v) * s) / steps));

      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const i of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) found.add(i);
    }

    return [...found];
  };

  const out: number[] = [];
  const outMaterial: number[] = [];

  for (let f = 0; f < faces; f++) {
    const corners = [0, 1, 2].map((k) => [pos[f * 9 + k * 3], pos[f * 9 + k * 3 + 1], pos[f * 9 + k * 3 + 2]]);
    const ring: number[][] = [];

    for (let k = 0; k < 3; k++) {
      const p = corners[k];
      const q = corners[(k + 1) % 3];
      const d = q.map((v, j) => v - p[j]);
      const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      ring.push(p);

      if (len2 < tol * tol) continue;

      const inside: [number, number[]][] = [];

      for (const i of near(p, q)) {
        const v = points[i];
        const s = ((v[0] - p[0]) * d[0] + (v[1] - p[1]) * d[1] + (v[2] - p[2]) * d[2]) / len2;

        if (s <= 0 || s >= 1) continue;

        const off = Math.hypot(v[0] - p[0] - s * d[0], v[1] - p[1] - s * d[1], v[2] - p[2] - s * d[2]);
        const fromEnds = Math.min(Math.hypot(v[0] - p[0], v[1] - p[1], v[2] - p[2]), Math.hypot(v[0] - q[0], v[1] - q[1], v[2] - q[2]));

        if (off < tol && fromEnds > tol) inside.push([s, v]);
      }

      inside.sort((x, y) => x[0] - y[0]);
      ring.push(...inside.map(([, v]) => v));
    }

    if (ring.length === 3) {
      out.push(...corners.flat());
      outMaterial.push(material[f]);
      continue;
    }

    const centre = [0, 1, 2].map((j) => (corners[0][j] + corners[1][j] + corners[2][j]) / 3);

    for (let i = 0; i < ring.length; i++) {
      out.push(...centre, ...ring[i], ...ring[(i + 1) % ring.length]);
      outMaterial.push(material[f]);
    }
  }

  return { pos: Float32Array.from(out), material: outMaterial };
}

export function boolean(a: Shape[], b: Shape[], op: "subtract" | "intersect"): Shape[] {
  const names = [...new Set([...a, ...b].map((s) => s.mat))];
  const materials = names.map((name) => new MeshBasicMaterial({ name }));
  const evaluator = new Evaluator();
  evaluator.attributes = ["position"];
  evaluator.useGroups = true;
  const result = evaluator.evaluate(brush(a, names, materials), brush(b, names, materials), op === "subtract" ? SUBTRACTION : INTERSECTION);
  const geometry = result.geometry as BufferGeometry;
  const used = (Array.isArray(result.material) ? result.material : [result.material]) as MeshBasicMaterial[];
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.attributes.position.count, materialIndex: 0 }];
  const raw = geometry.attributes.position.array as Float32Array;
  const kept = groups.filter((g) => g.count > 0);
  // The repair needs every face at once: a junction often sits between two materials.
  const repaired = closeTJunctions(
    Float32Array.from(kept.flatMap((g) => Array.from(raw.subarray(g.start * 3, (g.start + g.count) * 3)))),
    kept.flatMap((g) => Array<number>(g.count / 3).fill(g.materialIndex ?? 0)),
  );
  const out: Shape[] = [];

  for (const mat of new Set(repaired.material)) {
    const faces = repaired.material.flatMap((m, f) => (m === mat ? [f] : []));
    const mine = new Float32Array(faces.length * 9);
    faces.forEach((f, i) => mine.set(repaired.pos.subarray(f * 9, f * 9 + 9), i * 9));
    const part = new BufferGeometry();
    part.setAttribute("position", new BufferAttribute(mine, 3));
    out.push({ geometry: part, mat: used[mat].name });
  }

  if (out.length === 0) throw new Error(`the ${op === "subtract" ? "cut" : "intersection"} left nothing`);

  return out;
}
