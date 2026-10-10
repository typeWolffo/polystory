// Blender-style shading for a merged mesh: vertices welded by position,
// an edge sharp when it bends more than the angle, and one shared vertex
// per smooth fan around each position, with an angle-weighted normal. The
// result splits only where the look needs it, so the file stays small.
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export function shade(geometry: BufferGeometry, smoothAngleDeg: number): BufferGeometry {
  const welded = mergeVertices(geometry.index ? geometry.toNonIndexed() : geometry, 1e-5);
  const pos = welded.attributes.position.array as Float32Array;
  const idx = Array.from(welded.index!.array);
  const faces = idx.length / 3;
  const threshold = Math.cos((smoothAngleDeg * Math.PI) / 180 + 1e-3);
  const faceNormal = new Array<Vector3>(faces);
  const cornerAngle = new Float32Array(idx.length);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();

  for (let f = 0; f < faces; f++) {
    a.fromArray(pos, idx[f * 3] * 3);
    b.fromArray(pos, idx[f * 3 + 1] * 3);
    c.fromArray(pos, idx[f * 3 + 2] * 3);
    const ab = b.clone().sub(a);
    const ac = c.clone().sub(a);
    const bc = c.clone().sub(b);
    faceNormal[f] = ab.clone().cross(ac).normalize();
    cornerAngle[f * 3] = ab.angleTo(ac);
    cornerAngle[f * 3 + 1] = ab.clone().negate().angleTo(bc);
    cornerAngle[f * 3 + 2] = Math.PI - cornerAngle[f * 3] - cornerAngle[f * 3 + 1];
  }

  const edgeFaces = new Map<string, number[]>();
  const edgeKey = (p: number, q: number) => (p < q ? `${p}:${q}` : `${q}:${p}`);

  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(idx[f * 3 + k], idx[f * 3 + ((k + 1) % 3)]);
      const list = edgeFaces.get(key);

      if (list) list.push(f);
      else edgeFaces.set(key, [f]);
    }
  }

  const smoothEdge = (p: number, q: number): boolean => {
    const list = edgeFaces.get(edgeKey(p, q));

    if (!list || list.length !== 2) return false;

    return faceNormal[list[0]].dot(faceNormal[list[1]]) > threshold;
  };

  // Corners, not faces: a face welded down to two corners on one vertex
  // (a rounded box whose bevel meets in the middle) must still get both
  // corners assigned, and such a face is dropped from the output below.
  const vertexCorners = new Map<number, number[]>();

  for (let c = 0; c < idx.length; c++) {
    const list = vertexCorners.get(idx[c]);

    if (list) list.push(c);
    else vertexCorners.set(idx[c], [c]);
  }

  const outPos: number[] = [];
  const outNor: number[] = [];
  const outIdx = new Array<number>(idx.length).fill(0);
  const n = new Vector3();

  for (const [v, corners] of vertexCorners) {
    // Corners around v joined by a smooth edge through v belong to one fan.
    const parent = corners.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const edgeOwner = new Map<number, number>();

    corners.forEach((c, i) => {
      const f = Math.floor(c / 3);

      for (let k = 0; k < 3; k++) {
        const other = idx[f * 3 + k];

        if (other === v || !smoothEdge(v, other)) continue;

        const owner = edgeOwner.get(other);

        if (owner === undefined) edgeOwner.set(other, i);
        else parent[find(i)] = find(owner);
      }
    });

    const fans = new Map<number, number>();

    corners.forEach((c, i) => {
      const root = find(i);
      let out = fans.get(root);

      if (out === undefined) {
        out = outPos.length / 3;
        fans.set(root, out);
        n.set(0, 0, 0);

        corners.forEach((d, j) => {
          if (find(j) === root) n.addScaledVector(faceNormal[Math.floor(d / 3)], cornerAngle[d]);
        });

        n.normalize();
        outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        outNor.push(n.x, n.y, n.z);
      }

      outIdx[c] = out;
    });
  }

  const kept: number[] = [];
  const keptGroups: { start: number; count: number; materialIndex: number }[] = [];

  for (const g of geometry.groups) {
    const start = kept.length;

    for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) {
      const [a, b, c] = [outIdx[t * 3], outIdx[t * 3 + 1], outIdx[t * 3 + 2]];

      if (a !== b && b !== c && a !== c) kept.push(a, b, c);
    }

    keptGroups.push({ start, count: kept.length - start, materialIndex: g.materialIndex ?? 0 });
  }

  const result = new BufferGeometry();
  result.setAttribute("position", new BufferAttribute(new Float32Array(outPos), 3));
  result.setAttribute("normal", new BufferAttribute(new Float32Array(outNor), 3));
  result.setIndex(geometry.groups.length ? kept : outIdx);

  for (const g of (geometry.groups.length ? keptGroups : [{ start: 0, count: outIdx.length, materialIndex: 0 }])) result.addGroup(g.start, g.count, g.materialIndex);

  return result;
}
