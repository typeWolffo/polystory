// Writes the assembled parts as a GLB: a node per part at its pivot, a mesh
// per part (positions, normals, indices, one primitive per material group),
// an empty node per marker, and the clips as animations. Y-up as glTF wants.
import type { BufferGeometry } from "three";

import { type Animation, quatOf, toGltf } from "./animate.ts";
import type { AssembledPart } from "./kit.ts";
import type { MaterialSpec, Vec3 } from "./types.ts";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;

export function srgbHexToLinear(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;

    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return [channel(0), channel(2), channel(4)];
}

const pad4 = (n: number) => (n + 3) & ~3;
const isZero = (v: number[], rest: number[]) => v.every((c, i) => Math.abs(c - rest[i]) < 1e-9);

function materialJson(name: string, spec: MaterialSpec, extensionsUsed: Set<string>): Record<string, unknown> {
  const rgb = srgbHexToLinear(spec.hex);
  const strength = spec.emissive ?? 0;
  // glTF caps emissiveFactor at 1 per channel: a strength below 1 scales
  // the colour, a strength above 1 goes into the extension.
  const material: Record<string, unknown> = {
    name,
    pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: spec.metallic ?? 0, roughnessFactor: spec.roughness },
    emissiveFactor: strength > 0 ? rgb.map((c) => c * Math.min(strength, 1)) : [0, 0, 0],
  };

  if (strength > 1) {
    material.extensions = { KHR_materials_emissive_strength: { emissiveStrength: strength } };
    extensionsUsed.add("KHR_materials_emissive_strength");
  }

  return material;
}

export function writeGlb(root: AssembledPart, materials: { name: string; spec: MaterialSpec }[], animations: Animation[] = []): Buffer {
  const chunks: Buffer[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const nodeIndex = new Map<string, number>();
  let offset = 0;

  const view = (bytes: Buffer, target?: number): number => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    const padded = pad4(bytes.length);
    chunks.push(bytes, Buffer.alloc(padded - bytes.length));
    offset += padded;

    return bufferViews.length - 1;
  };
  const floats = (values: ArrayLike<number>) => Buffer.from(Float32Array.from(values).buffer);

  const writeMesh = (name: string, geometry: BufferGeometry, pivot: Vec3): number => {
    const pos = geometry.attributes.position.array as Float32Array;
    const nor = geometry.attributes.normal.array as Float32Array;
    const idx = geometry.index!.array;
    const verts = pos.length / 3;
    const positions = new Float32Array(pos.length);
    const normals = new Float32Array(nor.length);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    for (let i = 0; i < verts; i++) {
      const p = toGltf([pos[i * 3] - pivot[0], pos[i * 3 + 1] - pivot[1], pos[i * 3 + 2] - pivot[2]]);
      positions.set(p, i * 3);
      normals.set(toGltf([nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]]), i * 3);

      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }

    const wide = verts > 65535;
    const indices = wide ? Uint32Array.from(idx) : Uint16Array.from(idx);
    const position = accessors.push({ bufferView: view(Buffer.from(positions.buffer), ARRAY_BUFFER), componentType: FLOAT, count: verts, type: "VEC3", min, max }) - 1;
    const normal = accessors.push({ bufferView: view(Buffer.from(normals.buffer), ARRAY_BUFFER), componentType: FLOAT, count: verts, type: "VEC3" }) - 1;
    const indexView = view(Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength), ELEMENT_ARRAY_BUFFER);
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
    const primitives = groups.map((g) => {
      const indicesAccessor = accessors.push({ bufferView: indexView, byteOffset: g.start * (wide ? 4 : 2), componentType: wide ? 5125 : 5123, count: g.count, type: "SCALAR" }) - 1;

      return { attributes: { POSITION: position, NORMAL: normal }, indices: indicesAccessor, material: g.materialIndex ?? 0, mode: 4 };
    });

    return meshes.push({ name, primitives }) - 1;
  };

  const writeNode = (part: AssembledPart): number => {
    const index = nodes.push({}) - 1;
    nodeIndex.set(part.name, index);
    const node: Record<string, unknown> = { name: part.name };
    const offsetFromParent = toGltf([part.pivot[0] - part.parentPivot[0], part.pivot[1] - part.parentPivot[1], part.pivot[2] - part.parentPivot[2]]);

    if (!isZero(offsetFromParent, [0, 0, 0])) node.translation = offsetFromParent;

    if (part.geometry) node.mesh = writeMesh(part.name, part.geometry, part.pivot);

    const children = part.children.map(writeNode);

    for (const marker of part.markers) {
      const m: Record<string, unknown> = { name: marker.name, translation: toGltf([marker.at[0] - part.pivot[0], marker.at[1] - part.pivot[1], marker.at[2] - part.pivot[2]]) };
      const rotation = quatOf(marker.rot);

      if (!isZero(rotation, [0, 0, 0, 1])) m.rotation = rotation;

      children.push(nodes.push(m) - 1);
    }

    if (children.length) node.children = children;

    nodes[index] = node;

    return index;
  };

  writeNode(root);

  const gltfAnimations = animations.map((animation) => {
    const samplers: Record<string, unknown>[] = [];
    const channels = animation.channels.map((channel) => {
      const input = accessors.push({ bufferView: view(floats(channel.times)), componentType: FLOAT, count: channel.times.length, type: "SCALAR", min: [channel.times[0]], max: [channel.times[channel.times.length - 1]] }) - 1;
      const output = accessors.push({ bufferView: view(floats(channel.values)), componentType: FLOAT, count: channel.times.length, type: channel.path === "rotation" ? "VEC4" : "VEC3" }) - 1;
      samplers.push({ input, output, interpolation: channel.interpolation });

      return { sampler: samplers.length - 1, target: { node: nodeIndex.get(channel.node)!, path: channel.path } };
    });

    return { name: animation.name, channels, samplers };
  });

  const extensionsUsed = new Set<string>();
  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator: "polystory" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials: materials.map(({ name, spec }) => materialJson(name, spec, extensionsUsed)),
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  if (gltfAnimations.length) json.animations = gltfAnimations;

  if (extensionsUsed.size) json.extensionsUsed = [...extensionsUsed];

  const bin = Buffer.concat(chunks);
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
