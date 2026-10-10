// A GLB reader with no dependencies: the JSON chunk, the BIN chunk, typed
// accessors, and the geometry measures the checks and the scan need.
import { readFileSync } from "node:fs";

const COMPONENT = {
  5120: [Int8Array, 1],
  5121: [Uint8Array, 1],
  5122: [Int16Array, 2],
  5123: [Uint16Array, 2],
  5125: [Uint32Array, 4],
  5126: [Float32Array, 4],
};
const ELEMENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(path) {
  const buf = readFileSync(path);

  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB (bad magic)`);

  let offset = 12;
  let json = null;
  let bin = null;

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const chunk = buf.subarray(offset + 8, offset + 8 + length);

    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    else if (type === 0x004e4942) bin = chunk;

    offset += 8 + length;
  }

  if (!json) throw new Error(`${path} has no JSON chunk`);

  return { json, bin, bytes: buf.length };
}

export function accessorArray(gltf, bin, index) {
  const acc = gltf.accessors[index];
  const [Ctor, size] = COMPONENT[acc.componentType];
  const n = ELEMENTS[acc.type];
  const view = gltf.bufferViews[acc.bufferView];
  const stride = view.byteStride ?? n * size;
  const base = bin.byteOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Ctor(acc.count * n);

  if (stride === n * size) {
    const bytes = bin.buffer.slice(base, base + acc.count * n * size);

    out.set(new Ctor(bytes));
  } else {
    const dv = new DataView(bin.buffer);
    const read = { 1: (o) => (Ctor === Int8Array ? dv.getInt8(o) : dv.getUint8(o)), 2: (o) => (Ctor === Int16Array ? dv.getInt16(o, true) : dv.getUint16(o, true)), 4: (o) => (Ctor === Float32Array ? dv.getFloat32(o, true) : dv.getUint32(o, true)) }[size];

    for (let i = 0; i < acc.count; i++) {
      for (let j = 0; j < n; j++) out[i * n + j] = read(base + i * stride + j * size);
    }
  }

  return out;
}

export function linearToSrgbHex(rgb) {
  const channel = (c) => {
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

    return Math.round(Math.min(1, Math.max(0, s)) * 255).toString(16).padStart(2, "0");
  };

  return `#${rgb.slice(0, 3).map(channel).join("")}`.toUpperCase();
}

export function srgbHexToLinear(hex) {
  const h = hex.replace("#", "");

  return [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;

    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}

export function materialSummary(gltf) {
  return (gltf.materials ?? []).map((m) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const base = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const emissive = m.emissiveFactor ?? [0, 0, 0];

    return {
      name: m.name ?? "",
      hex: linearToSrgbHex(base),
      alpha: base[3] ?? 1,
      roughness: pbr.roughnessFactor ?? 1,
      metallic: pbr.metallicFactor ?? 1,
      emissive: Math.max(...emissive) > 0.01 ? linearToSrgbHex(emissive) : null,
      emissiveStrength: m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? (Math.max(...emissive) > 0.01 ? 1 : 0),
      textured: Boolean(pbr.baseColorTexture || pbr.metallicRoughnessTexture || m.normalTexture || m.emissiveTexture || m.occlusionTexture),
      alphaMode: m.alphaMode ?? "OPAQUE",
      doubleSided: Boolean(m.doubleSided),
    };
  });
}

// Triangles, vertices and the bounds across every primitive, from the
// accessors alone so a check never touches the BIN chunk.
export function meshStats(gltf) {
  let tris = 0;
  let verts = 0;
  let nonTriangle = false;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives) {
      const position = gltf.accessors[prim.attributes.POSITION];
      verts += position.count;
      tris += prim.indices === undefined ? position.count / 3 : gltf.accessors[prim.indices].count / 3;

      if (prim.mode !== undefined && prim.mode !== 4) nonTriangle = true;

      if (position.min && position.max) {
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], position.min[i]);
          max[i] = Math.max(max[i], position.max[i]);
        }
      }
    }
  }

  const finite = min.every(Number.isFinite);

  return { tris, verts, nonTriangle, bounds: finite ? { min, max } : null };
}

export function extentOf(bounds) {
  return bounds ? bounds.max.map((v, i) => v - bounds.min[i]) : [0, 0, 0];
}

export function centreOf(bounds) {
  return bounds ? bounds.max.map((v, i) => (v + bounds.min[i]) / 2) : [0, 0, 0];
}

// The dihedral angle of every edge, with vertices welded by position so a
// flat-shaded export (split vertices) measures the same as a smooth one.
export function edgeAngles(gltf, bin, sampleLimit = 400000) {
  const buckets = { flat: 0, soft: 0, rounded: 0, hard: 0, sharp: 0 };
  let edges = 0;
  let boundary = 0;
  let faces = 0;

  if (!bin) return { buckets, edges, boundary, faces };

  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives) {
      if (prim.mode !== undefined && prim.mode !== 4) continue;

      const pos = accessorArray(gltf, bin, prim.attributes.POSITION);
      const idx = prim.indices === undefined ? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i) : accessorArray(gltf, bin, prim.indices);
      const weld = new Map();
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

      const normals = new Map();
      const triangles = Math.min(idx.length / 3, sampleLimit);

      for (let t = 0; t < triangles; t++) {
        const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
        const n = faceNormal(pos, a, b, c);

        if (!n) continue;

        faces++;
        const wa = welded[a];
        const wb = welded[b];
        const wc = welded[c];

        for (const [p, q] of [[wa, wb], [wb, wc], [wc, wa]]) {
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

function faceNormal(pos, a, b, c) {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
  const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);

  return len < 1e-12 ? null : [nx / len, ny / len, nz / len];
}

// World translation of every node, for socket tables and root checks.
export function nodeWorldPositions(gltf) {
  const nodes = gltf.nodes ?? [];
  const out = new Map();
  const visit = (index, parent) => {
    const node = nodes[index];
    const local = node.matrix ? node.matrix : trs(node);
    const world = multiply(parent, local);
    out.set(index, { name: node.name ?? "", position: [world[12], world[13], world[14]], mesh: node.mesh, skin: node.skin, children: node.children ?? [] });

    for (const child of node.children ?? []) visit(child, world);
  };

  for (const scene of gltf.scenes ?? []) {
    for (const root of scene.nodes ?? []) visit(root, IDENTITY);
  }

  return out;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function trs(node) {
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

function multiply(a, b) {
  const out = new Array(16).fill(0);

  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    }
  }

  return out;
}

export function rootTransformOff(node) {
  const moved = node.translation?.some((v) => Math.abs(v) > 1e-4);
  const turned = node.rotation?.some((v, i) => Math.abs(v - (i === 3 ? 1 : 0)) > 1e-4);
  const scaled = node.scale?.some((v) => Math.abs(v - 1) > 1e-4);
  const matrixed = node.matrix?.some((v, i) => Math.abs(v - IDENTITY[i]) > 1e-4);

  return Boolean(moved || turned || scaled || matrixed);
}

export function skinJointNames(gltf) {
  const names = (gltf.nodes ?? []).map((n) => n.name ?? "");

  return (gltf.skins ?? []).map((skin) => skin.joints.map((j) => names[j]));
}
