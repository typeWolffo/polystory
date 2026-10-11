// A recipe's clips as glTF channels. Rotations are always sampled at the
// clip's fps from interpolated angles, so a key 360° from the last spins a
// full turn instead of taking the shortest way back to where it started.
import { Quaternion } from "three";

import { placement } from "./geometry.ts";
import type { AssembledPart, ClipSpec } from "./kit.ts";
import type { Track, Vec3 } from "./types.ts";

export type Channel = { node: string; path: "translation" | "rotation" | "scale"; interpolation: "LINEAR" | "STEP"; times: number[]; values: number[] };
export type Animation = { name: string; channels: Channel[] };

type Value = Vec3 | number;
type Keys = [number, Value][];
type Source = Keys | ((t: number) => Value);

/** Recipe space (+Z up, -Y forward) into glTF's (+Y up, +Z forward). */
export const toGltf = ([x, y, z]: Vec3): Vec3 => [x, z, -y];

export function quatOf(rot: Vec3): [number, number, number, number] {
  const q = new Quaternion().setFromRotationMatrix(placement(0, 0, 0, rot));

  return [q.x, q.z, -q.y, q.w];
}

const asVec = (v: Value): Vec3 => (typeof v === "number" ? [v, v, v] : v);
const scaleOf = (v: Value): Vec3 => {
  const [x, y, z] = asVec(v);

  return [x, z, y];
};

function framesOf(clip: ClipSpec): number[] {
  const n = Math.max(1, Math.round(clip.duration * clip.fps));

  return Array.from({ length: n + 1 }, (_, i) => (clip.duration * i) / n);
}

function checkKeys(keys: Keys, where: string, duration: number): void {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error(`${where}: keys are [seconds, value] pairs, at least one`);

  keys.forEach(([t], i) => {
    if (typeof t !== "number" || t < -1e-6 || t > duration + 1e-6) throw new Error(`${where}: key ${i} is at ${t} s, outside 0..${duration}`);

    if (i > 0 && t < keys[i - 1][0]) throw new Error(`${where}: keys must run forward in time`);
  });
}

function valueAt(keys: Keys, t: number, smooth: boolean): Vec3 {
  if (t <= keys[0][0]) return asVec(keys[0][1]);

  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];

    if (t > t1) continue;

    const [t0, v0] = keys[i - 1];
    const linear = t1 - t0 > 1e-9 ? (t - t0) / (t1 - t0) : 1;
    const f = smooth ? linear * linear * (3 - 2 * linear) : linear;
    const a = asVec(v0);
    const b = asVec(v1);

    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  return asVec(keys[keys.length - 1][1]);
}

function vectorChannel(node: string, path: "translation" | "scale", source: Source, ease: Track["ease"], clip: ClipSpec, convert: (v: Value) => Vec3): Channel {
  const where = `clip "${clip.name}", ${node}.${path === "translation" ? "pos" : "scale"}`;

  if (typeof source === "function") {
    const times = framesOf(clip);

    return { node, path, interpolation: "LINEAR", times, values: times.flatMap((t) => convert(source(t))) };
  }

  checkKeys(source, where, clip.duration);

  if (ease === "smooth") {
    const times = framesOf(clip);

    return { node, path, interpolation: "LINEAR", times, values: times.flatMap((t) => convert(valueAt(source, t, true))) };
  }

  return { node, path, interpolation: ease === "step" ? "STEP" : "LINEAR", times: source.map(([t]) => t), values: source.flatMap(([, v]) => convert(v)) };
}

function rotationChannel(node: string, source: Keys | ((t: number) => Vec3), ease: Track["ease"], clip: ClipSpec): Channel {
  if (typeof source !== "function") checkKeys(source, `clip "${clip.name}", ${node}.rot`, clip.duration);

  if (typeof source !== "function" && ease === "step") {
    return { node, path: "rotation", interpolation: "STEP", times: source.map(([t]) => t), values: source.flatMap(([, v]) => quatOf(asVec(v))) };
  }

  const times = framesOf(clip);
  const values: number[] = [];
  let previous: number[] | null = null;

  for (const t of times) {
    const q = quatOf(typeof source === "function" ? source(t) : valueAt(source, t, ease === "smooth"));

    // Neighbouring keys on the same hemisphere, or the player turns the long way.
    if (previous && q[0] * previous[0] + q[1] * previous[1] + q[2] * previous[2] + q[3] * previous[3] < 0) q.forEach((c, i) => (q[i] = -c));

    values.push(...q);
    previous = q;
  }

  return { node, path: "rotation", interpolation: "LINEAR", times, values };
}

export function sampleClips(clips: ClipSpec[], root: AssembledPart): Animation[] {
  const rest = new Map<string, Vec3>();
  const visit = (part: AssembledPart) => {
    rest.set(part.name, [part.pivot[0] - part.parentPivot[0], part.pivot[1] - part.parentPivot[1], part.pivot[2] - part.parentPivot[2]]);
    part.children.forEach(visit);
  };
  visit(root);

  return clips.map((clip) => {
    const channels: Channel[] = [];

    for (const [target, track] of Object.entries(clip.tracks)) {
      const at = rest.get(target);

      if (!at) throw new Error(`clip "${clip.name}" moves "${target}", which is not a part: ${[...rest.keys()].join(", ")}`);

      if (track.pos) channels.push(vectorChannel(target, "translation", track.pos as Source, track.ease, clip, (v) => toGltf([at[0] + asVec(v)[0], at[1] + asVec(v)[1], at[2] + asVec(v)[2]])));

      if (track.rot) channels.push(rotationChannel(target, track.rot as Keys | ((t: number) => Vec3), track.ease, clip));

      if (track.scale !== undefined) channels.push(vectorChannel(target, "scale", track.scale as Source, track.ease, clip, scaleOf));
    }

    if (channels.length === 0) throw new Error(`clip "${clip.name}" moves nothing`);

    return { name: clip.name, channels };
  });
}
