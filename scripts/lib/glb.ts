// A GLB reader with no dependencies: the JSON chunk, the BIN chunk, typed
// accessors, and the geometry measures the checks and the scan need.
import { readFileSync } from "node:fs";

export type Accessor = { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] };
export type Material = {
  name?: string;
  pbrMetallicRoughness?: { baseColorFactor?: number[]; roughnessFactor?: number; metallicFactor?: number; baseColorTexture?: unknown; metallicRoughnessTexture?: unknown };
  emissiveFactor?: number[];
  normalTexture?: unknown;
  emissiveTexture?: unknown;
  occlusionTexture?: unknown;
  alphaMode?: string;
  doubleSided?: boolean;
  extensions?: { KHR_materials_emissive_strength?: { emissiveStrength?: number } };
};
export type Node = { name?: string; mesh?: number; skin?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] };
export type Gltf = {
  scenes?: { nodes?: number[] }[];
  nodes?: Node[];
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: Material[];
  accessors?: Accessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  images?: unknown[];
  textures?: unknown[];
  animations?: { name?: string; channels?: { sampler: number; target: { node?: number; path: string } }[]; samplers?: { input: number; output: number; interpolation?: string }[] }[];
  skins?: { joints: number[] }[];
};

type TypedArrayCtor = Float32ArrayConstructor | Uint32ArrayConstructor | Uint16ArrayConstructor | Uint8ArrayConstructor | Int16ArrayConstructor | Int8ArrayConstructor;
const COMPONENT: Record<number, [TypedArrayCtor, number]> = {
  5120: [Int8Array, 1],
  5121: [Uint8Array, 1],
  5122: [Int16Array, 2],
  5123: [Uint16Array, 2],
  5125: [Uint32Array, 4],
  5126: [Float32Array, 4],
};
const ELEMENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(path: string): { json: Gltf; bin: Buffer | null; bytes: number } {
  const buf = readFileSync(path);

  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB (bad magic)`);

  let offset = 12;
  let json: Gltf | null = null;
  let bin: Buffer | null = null;

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const chunk = buf.subarray(offset + 8, offset + 8 + length);

    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8")) as Gltf;
    else if (type === 0x004e4942) bin = chunk;

    offset += 8 + length;
  }

  if (!json) throw new Error(`${path} has no JSON chunk`);

  return { json, bin, bytes: buf.length };
}

export function accessorArray(gltf: Gltf, bin: Buffer, index: number): Float32Array | Uint32Array | Uint16Array | Uint8Array | Int16Array | Int8Array {
  const acc = gltf.accessors![index];
  const [Ctor, size] = COMPONENT[acc.componentType];
  const n = ELEMENTS[acc.type];
  const view = gltf.bufferViews![acc.bufferView!];
  const stride = view.byteStride ?? n * size;
  const base = bin.byteOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Ctor(acc.count * n);

  if (stride === n * size) {
    out.set(new Ctor(bin.buffer.slice(base, base + acc.count * n * size)) as never);
  } else {
    const dv = new DataView(bin.buffer);

    for (let i = 0; i < acc.count; i++) {
      for (let j = 0; j < n; j++) {
        const o = base + i * stride + j * size;
        out[i * n + j] = Ctor === Float32Array ? dv.getFloat32(o, true) : Ctor === Uint32Array ? dv.getUint32(o, true) : Ctor === Uint16Array ? dv.getUint16(o, true) : Ctor === Int16Array ? dv.getInt16(o, true) : Ctor === Int8Array ? dv.getInt8(o) : dv.getUint8(o);
      }
    }
  }

  return out;
}

export function linearToSrgbHex(rgb: number[]): string {
  const channel = (c: number) => {
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

    return Math.round(Math.min(1, Math.max(0, s)) * 255).toString(16).padStart(2, "0");
  };

  return `#${rgb.slice(0, 3).map(channel).join("")}`.toUpperCase();
}

export function srgbHexToLinear(hex: string): number[] {
  const h = hex.replace("#", "");

  return [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;

    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}

export type MaterialSummary = { name: string; hex: string; alpha: number; roughness: number; metallic: number; emissive: string | null; emissiveStrength: number; textured: boolean; alphaMode: string; doubleSided: boolean };

export function materialSummary(gltf: Gltf): MaterialSummary[] {
  return (gltf.materials ?? []).map((m) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const base = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const emissive = m.emissiveFactor ?? [0, 0, 0];
    const glows = Math.max(...emissive) > 0.01;

    return {
      name: m.name ?? "",
      hex: linearToSrgbHex(base),
      alpha: base[3] ?? 1,
      roughness: pbr.roughnessFactor ?? 1,
      metallic: pbr.metallicFactor ?? 1,
      emissive: glows ? linearToSrgbHex(emissive) : null,
      emissiveStrength: m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? (glows ? 1 : 0),
      textured: Boolean(pbr.baseColorTexture || pbr.metallicRoughnessTexture || m.normalTexture || m.emissiveTexture || m.occlusionTexture),
      alphaMode: m.alphaMode ?? "OPAQUE",
      doubleSided: Boolean(m.doubleSided),
    };
  });
}

export type Bounds = { min: number[]; max: number[] };

// Triangles, vertices and the bounds across every primitive, from the
// accessors alone so a check never touches the BIN chunk. Primitives of
// one mesh may share a vertex buffer; it is counted once. The bounds are
// of the rest pose: each mesh's box moved by its node's world transform.
export function meshStats(gltf: Gltf): { tris: number; verts: number; nonTriangle: boolean; bounds: Bounds | null } {
  let tris = 0;
  let verts = 0;
  let nonTriangle = false;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const counted = new Set<number>();
  const placements = [...nodeWorldMatrices(gltf)].filter(([i]) => gltf.nodes![i].mesh !== undefined).map(([i, m]) => ({ mesh: gltf.nodes![i].mesh!, matrix: m }));
  const grow = (point: number[]) => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], point[i]);
      max[i] = Math.max(max[i], point[i]);
    }
  };

  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives) {
      const position = gltf.accessors![prim.attributes.POSITION];

      if (!counted.has(prim.attributes.POSITION)) {
        counted.add(prim.attributes.POSITION);
        verts += position.count;
      }

      tris += prim.indices === undefined ? position.count / 3 : gltf.accessors![prim.indices].count / 3;

      if (prim.mode !== undefined && prim.mode !== 4) nonTriangle = true;
    }
  }

  const boxes = (placements.length ? placements : (gltf.meshes ?? []).map((_, mesh) => ({ mesh, matrix: IDENTITY }))).flatMap(({ mesh, matrix }) =>
    gltf.meshes![mesh].primitives.map((prim) => ({ accessor: gltf.accessors![prim.attributes.POSITION], matrix })),
  );

  for (const { accessor, matrix } of boxes) {
    if (!accessor.min || !accessor.max) continue;

    for (let corner = 0; corner < 8; corner++) {
      const [x, y, z] = [0, 1, 2].map((k) => ((corner >> k) & 1 ? accessor.max![k] : accessor.min![k]));
      grow([0, 1, 2].map((k) => matrix[k] * x + matrix[4 + k] * y + matrix[8 + k] * z + matrix[12 + k]));
    }
  }

  return { tris, verts, nonTriangle, bounds: min.every(Number.isFinite) ? { min, max } : null };
}

export const extentOf = (bounds: Bounds | null): number[] => (bounds ? bounds.max.map((v, i) => v - bounds.min[i]) : [0, 0, 0]);
export const centreOf = (bounds: Bounds | null): number[] => (bounds ? bounds.max.map((v, i) => (v + bounds.min[i]) / 2) : [0, 0, 0]);

export type EdgeBuckets = { flat: number; soft: number; rounded: number; hard: number; sharp: number };

// The dihedral angle of every edge, with vertices welded by position so a
// flat-shaded export (split vertices) measures the same as a smooth one.
export function edgeAngles(gltf: Gltf, bin: Buffer | null, sampleLimit = 400000): { buckets: EdgeBuckets; edges: number; boundary: number; faces: number } {
  const buckets: EdgeBuckets = { flat: 0, soft: 0, rounded: 0, hard: 0, sharp: 0 };
  let edges = 0;
  let boundary = 0;
  let faces = 0;

  if (!bin) return { buckets, edges, boundary, faces };

  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives) {
      if (prim.mode !== undefined && prim.mode !== 4) continue;

      const pos = accessorArray(gltf, bin, prim.attributes.POSITION) as Float32Array;
      const idx = prim.indices === undefined ? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i) : accessorArray(gltf, bin, prim.indices);
      const weld = new Map<string, number>();
      const welded = new Uint32Array(pos.length / 3);

      for (let v = 0; v < pos.length / 3; v++) {
        const key = `${Math.round(pos[v * 3] * 1e4)},${Math.round(pos[v * 3 + 1] * 1e4)},${Math.round(pos[v * 3 + 2] * 1e4)}`;
        let id = weld.get(key);

        if (id === undefined) {
          id = weld.size;
          weld.set(key, id);
        }

        welded[v] = id;
      }

      const normals = new Map<string, number[][]>();
      const triangles = Math.min(idx.length / 3, sampleLimit);

      for (let t = 0; t < triangles; t++) {
        const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
        const n = faceNormal(pos, a, b, c);

        if (!n) continue;

        faces++;

        for (const [p, q] of [[welded[a], welded[b]], [welded[b], welded[c]], [welded[c], welded[a]]]) {
          if (p === q) continue;

          const key = p < q ? `${p}:${q}` : `${q}:${p}`;
          const list = normals.get(key);

          if (list) list.push(n);
          else normals.set(key, [n]);
        }
      }

      for (const list of normals.values()) {
        edges++;

        if (list.length < 2) {
          boundary++;
          continue;
        }

        const dot = Math.min(1, Math.max(-1, list[0][0] * list[1][0] + list[0][1] * list[1][1] + list[0][2] * list[1][2]));
        const deg = (Math.acos(dot) * 180) / Math.PI;

        if (deg < 2) buckets.flat++;
        else if (deg < 12) buckets.soft++;
        else if (deg < 35) buckets.rounded++;
        else if (deg < 70) buckets.hard++;
        else buckets.sharp++;
      }
    }
  }

  return { buckets, edges, boundary, faces };
}

function faceNormal(pos: Float32Array, a: number, b: number, c: number): number[] | null {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
  const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);

  return len < 1e-12 ? null : [nx / len, ny / len, nz / len];
}

export type NodeWorld = { name: string; position: number[]; mesh?: number; skin?: number; children: number[] };

export function nodeWorldMatrices(gltf: Gltf): Map<number, number[]> {
  const nodes = gltf.nodes ?? [];
  const out = new Map<number, number[]>();
  const visit = (index: number, parent: number[]) => {
    const node = nodes[index];
    const world = multiply(parent, node.matrix ?? trs(node));
    out.set(index, world);

    for (const child of node.children ?? []) visit(child, world);
  };

  for (const scene of gltf.scenes ?? []) for (const root of scene.nodes ?? []) visit(root, IDENTITY);

  return out;
}

// World translation of every node, for socket tables and root checks.
export function nodeWorldPositions(gltf: Gltf): Map<number, NodeWorld> {
  const nodes = gltf.nodes ?? [];
  const out = new Map<number, NodeWorld>();

  for (const [index, world] of nodeWorldMatrices(gltf)) {
    const node = nodes[index];
    out.set(index, { name: node.name ?? "", position: [world[12], world[13], world[14]], mesh: node.mesh, skin: node.skin, children: node.children ?? [] });
  }

  return out;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function trs(node: Node): number[] {
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;

  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);

  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];

  return out;
}

export function rootTransformOff(node: Node): boolean {
  const moved = node.translation?.some((v) => Math.abs(v) > 1e-4);
  const turned = node.rotation?.some((v, i) => Math.abs(v - (i === 3 ? 1 : 0)) > 1e-4);
  const scaled = node.scale?.some((v) => Math.abs(v - 1) > 1e-4);
  const matrixed = node.matrix?.some((v, i) => Math.abs(v - IDENTITY[i]) > 1e-4);

  return Boolean(moved || turned || scaled || matrixed);
}

export function skinJointNames(gltf: Gltf): string[][] {
  const names = (gltf.nodes ?? []).map((n) => n.name ?? "");

  return (gltf.skins ?? []).map((skin) => skin.joints.map((j) => names[j]));
}
