// Writes a single-mesh GLB from an assembled geometry: positions, normals,
// indices, one primitive per material group, Y-up as glTF wants.
import type { BufferGeometry } from "three";

import type { MaterialSpec } from "./types.ts";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function srgbHexToLinear(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;

    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return [channel(0), channel(2), channel(4)];
}

const pad4 = (n: number) => (n + 3) & ~3;

export function writeGlb(name: string, geometry: BufferGeometry, materials: { name: string; spec: MaterialSpec }[]): Buffer {
  const pos = geometry.attributes.position.array as Float32Array;
  const nor = geometry.attributes.normal.array as Float32Array;
  const idx = geometry.index!.array;
  const verts = pos.length / 3;
  const positions = new Float32Array(pos.length);
  const normals = new Float32Array(nor.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  // Recipe space is +Z up, -Y forward; glTF is +Y up, +Z toward the viewer.
  for (let i = 0; i < verts; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 2];
    const z = -pos[i * 3 + 1];
    positions.set([x, y, z], i * 3);
    normals.set([nor[i * 3], nor[i * 3 + 2], -nor[i * 3 + 1]], i * 3);
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  }

  const wide = verts > 65535;
  const indices = wide ? Uint32Array.from(idx) : Uint16Array.from(idx);
  const posBytes = Buffer.from(positions.buffer);
  const norBytes = Buffer.from(normals.buffer);
  const idxBytes = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
  const bin = Buffer.concat([posBytes, norBytes, idxBytes, Buffer.alloc(pad4(idxBytes.length) - idxBytes.length)]);
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
  const accessors: unknown[] = [
    { bufferView: 0, componentType: 5126, count: verts, type: "VEC3", min, max },
    { bufferView: 1, componentType: 5126, count: verts, type: "VEC3" },
  ];
  const primitives = groups.map((g) => {
    accessors.push({ bufferView: 2, byteOffset: g.start * (wide ? 4 : 2), componentType: wide ? 5125 : 5123, count: g.count, type: "SCALAR" });

    return { attributes: { POSITION: 0, NORMAL: 1 }, indices: accessors.length - 1, material: g.materialIndex ?? 0, mode: 4 };
  });
  const extensionsUsed = new Set<string>();
  const gltfMaterials = materials.map(({ name: matName, spec }) => {
    const rgb = srgbHexToLinear(spec.hex);
    const strength = spec.emissive ?? 0;
    // glTF caps emissiveFactor at 1 per channel: a strength below 1 scales
    // the colour, a strength above 1 goes into the extension.
    const material: Record<string, unknown> = {
      name: matName,
      pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: spec.metallic ?? 0, roughnessFactor: spec.roughness },
      emissiveFactor: strength > 0 ? rgb.map((c) => c * Math.min(strength, 1)) : [0, 0, 0],
    };

    if (strength > 1) {
      material.extensions = { KHR_materials_emissive_strength: { emissiveStrength: strength } };
      extensionsUsed.add("KHR_materials_emissive_strength");
    }

    return material;
  });
  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator: "polystory" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives }],
    materials: gltfMaterials,
    accessors,
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length, byteLength: norBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length + norBytes.length, byteLength: idxBytes.length, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  if (extensionsUsed.size) json.extensionsUsed = [...extensionsUsed];

  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc(pad4(jsonBytes.length) - jsonBytes.length, 0x20)]);
  const total = 12 + 8 + jsonPadded.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  let o = 0;
  o = out.writeUInt32LE(GLB_MAGIC, o);
  o = out.writeUInt32LE(2, o);
  o = out.writeUInt32LE(total, o);
  o = out.writeUInt32LE(jsonPadded.length, o);
  o = out.writeUInt32LE(CHUNK_JSON, o);
  o += jsonPadded.copy(out, o);
  o = out.writeUInt32LE(bin.length, o);
  o = out.writeUInt32LE(CHUNK_BIN, o);
  bin.copy(out, o);

  return out;
}
