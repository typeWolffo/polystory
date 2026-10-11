export type Knobs = {
  bevel: number;
  bevelSegments: number;
  segments: number;
  sphere: [number, number];
  smooth: boolean;
  smoothAngle: number;
  minThickness: number;
  materialsPerItem?: number;
};

export type MaterialSpec = {
  hex: string;
  roughness: number;
  metallic?: number;
  emissive?: number;
  role?: string;
};

export type Style = {
  schemaVersion: 1;
  direction?: string;
  knobs: Knobs;
  perKind?: Record<string, Partial<Knobs>>;
  materials: Record<string, MaterialSpec>;
  calibration?: Record<string, string>;
};

export type Vec3 = [number, number, number];

export type Item = {
  kind: string;
  id: string;
  model: string;
  slot?: string;
  smooth_angle?: number;
  /** Where the preview shows it, over the kind's: `{ mount: "beside", socket: "socket_hat", offset: [0, 0, 0] }` for a thing worn on the head. */
  preview?: { mount?: "socket" | "beside" | "turntable"; socket?: string; offset?: [number, number, number]; farMetres?: number; scaleFigure?: boolean };
  [extra: string]: unknown;
};

/** Bends, twists and tapers act on a part before it is placed; `t` runs 0..1 up the part's own z, `box` is its bounds there. */
export type Warp = { fn: (p: Vec3, t: number, box: { min: Vec3; max: Vec3 }) => Vec3; detail?: number };

type Placed = { x?: number; y?: number; z?: number; mat?: string; rot?: Vec3; warp?: Warp | Warp[] };
type Bevelled = { bevel?: number; bevel_segments?: number };
type Point2 = [number, number];

export type CylinderOpts = Placed & Bevelled & { r: number; h: number; segments?: number };
export type ConeOpts = Placed & Bevelled & { r1: number; r2: number; h: number; segments?: number };
export type SphereOpts = Placed & { r: number; u?: number; v?: number; scale?: Vec3 };
export type BoxOpts = Placed & Bevelled & { sx: number; sy: number; sz: number };
export type TorusOpts = Placed & { R: number; r: number; segments?: number; minor?: number };
export type TubeOpts = { points: Vec3[]; r: number; mat?: string; segments?: number; smooth?: boolean | number; warp?: Warp | Warp[] };
export type LatheOpts = Placed & Bevelled & { profile: Point2[]; segments?: number };
export type BlobOpts = { balls: [number, number, number, number][]; mat?: string; resolution?: number; blend?: number; warp?: Warp | Warp[] };
export type ExtrudeOpts = Placed & Bevelled & { outline: Point2[]; holes?: Point2[][]; depth: number; smooth?: boolean | number };
export type LoftSection = { at: Vec3; r?: number; size?: Point2; shape?: Point2[]; turn?: number };
export type LoftOpts = { sections: LoftSection[]; mat?: string; segments?: number; smooth?: boolean | number; caps?: boolean; warp?: Warp | Warp[] };
export type HullOpts = { points: Vec3[]; mat?: string; warp?: Warp | Warp[] };
/** Any three.js BufferGeometry in recipe space (+Z up); kit.three makes one. */
export type MeshOpts = Placed & { geometry: object };
export type CutOpts = { from: (kit: Kit) => void; away: (kit: Kit) => void };
export type IntersectOpts = { a: (kit: Kit) => void; b: (kit: Kit) => void };

export type PartOpts = { name: string; pivot?: Vec3 };
export type MarkerOpts = { name: string; x?: number; y?: number; z?: number; rot?: Vec3 };

type Keys<T> = [number, T][];
/** Keys as [seconds, value] pairs, or a function of the time in seconds sampled at the clip's fps. */
export type Track = {
  /** Degrees around the part's pivot, the same order as `rot`; the rest pose is [0, 0, 0]. */
  rot?: Keys<Vec3> | ((t: number) => Vec3);
  /** Metres from where the part rests. */
  pos?: Keys<Vec3> | ((t: number) => Vec3);
  scale?: Keys<Vec3 | number> | ((t: number) => Vec3 | number);
  /** How keys run into each other: straight, eased in and out, or held. Functions ignore it. */
  ease?: "linear" | "smooth" | "step";
};
export type ClipOpts = { name: string; duration: number; fps?: number };

export type Kit = {
  cylinder(opts: CylinderOpts): void;
  cone(opts: ConeOpts): void;
  sphere(opts: SphereOpts): void;
  box(opts: BoxOpts): void;
  torus(opts: TorusOpts): void;
  tube(opts: TubeOpts): void;
  lathe(opts: LatheOpts): void;
  blob(opts: BlobOpts): void;
  extrude(opts: ExtrudeOpts): void;
  loft(opts: LoftOpts): void;
  hull(opts: HullOpts): void;
  mesh(opts: MeshOpts): void;
  cut(opts: CutOpts): void;
  intersect(opts: IntersectOpts): void;
  part(opts: PartOpts, build: (kit: Kit) => void): void;
  marker(opts: MarkerOpts): void;
  clip(opts: ClipOpts, tracks: Record<string, Track>): void;
  bend(opts: { angle: number; toward?: "x" | "-x" | "y" | "-y"; detail?: number }): Warp;
  twist(opts: { angle: number; detail?: number }): Warp;
  taper(opts: { top: number; bottom?: number; detail?: number }): Warp;
  noise(opts: { amount: number; size?: number; seed?: number; detail?: number }): Warp;
  /** The three.js namespace, typed loosely so a project without @types/three still type-checks. */
  readonly three: Record<string, any>;
  /** ConvexGeometry and ParametricGeometry from three's addons. */
  readonly addons: Record<string, any>;
};

export type Recipe = {
  ITEM: Item;
  build(kit: Kit): void;
};

export type BuildStats = {
  tris: number;
  verts: number;
  materials: string[];
  min: Vec3;
  max: Vec3;
  parts: string[];
  markers: string[];
  clips: { name: string; duration: number }[];
};
