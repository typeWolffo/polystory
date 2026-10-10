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

type Placed = { x?: number; y?: number; z?: number; mat?: string; rot?: Vec3 };
type Bevelled = { bevel?: number; bevel_segments?: number };

export type CylinderOpts = Placed & Bevelled & { r: number; h: number; segments?: number };
export type ConeOpts = Placed & Bevelled & { r1: number; r2: number; h: number; segments?: number };
export type SphereOpts = Placed & { r: number; u?: number; v?: number; scale?: Vec3 };
export type BoxOpts = Placed & Bevelled & { sx: number; sy: number; sz: number };
export type TorusOpts = Placed & { R: number; r: number; segments?: number; minor?: number };
export type TubeOpts = { points: Vec3[]; r: number; mat?: string; segments?: number; smooth?: boolean | number };
export type LatheOpts = Placed & Bevelled & { profile: [number, number][]; segments?: number };
export type BlobOpts = { balls: [number, number, number, number][]; mat?: string; resolution?: number; blend?: number };

export type Kit = {
  cylinder(opts: CylinderOpts): void;
  cone(opts: ConeOpts): void;
  sphere(opts: SphereOpts): void;
  box(opts: BoxOpts): void;
  torus(opts: TorusOpts): void;
  tube(opts: TubeOpts): void;
  lathe(opts: LatheOpts): void;
  blob(opts: BlobOpts): void;
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
};
