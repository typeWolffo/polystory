// The calibration set: a mug, a crate and a ball with a fuse, 0.3 m each,
// in a row. The same recipe under every direction's knobs shows what each
// look does to the same shapes.
import type { Item, Kit } from "polystory";

export const ITEM: Item = { kind: "calibration", id: "calibration", model: "calibration" };

export function build(kit: Kit) {
  // A mug on the left.
  kit.cylinder({ r: 0.12, h: 0.26, x: -0.5, mat: "base" });
  kit.cylinder({ r: 0.1, h: 0.03, x: -0.5, z: 0.26, mat: "light" });
  kit.torus({ R: 0.11, r: 0.025, x: -0.33, z: 0.14, mat: "base", rot: [90, 0, 0] });
  kit.cylinder({ r: 0.02, h: 0.012, x: -0.5, y: -0.115, z: 0.13, mat: "accent", rot: [90, 0, 0] });

  // A crate in the middle.
  kit.box({ sx: 0.3, sy: 0.3, sz: 0.3, z: 0.15, mat: "accent" });
  kit.box({ sx: 0.32, sy: 0.04, sz: 0.04, z: 0.29, mat: "dark" });
  kit.box({ sx: 0.32, sy: 0.04, sz: 0.04, z: 0.01, mat: "dark" });
  kit.box({ sx: 0.04, sy: 0.32, sz: 0.04, z: 0.29, mat: "dark" });
  kit.box({ sx: 0.04, sy: 0.32, sz: 0.04, z: 0.01, mat: "dark" });
  kit.box({ sx: 0.04, sy: 0.04, sz: 0.32, x: 0.14, y: 0.14, z: 0.15, mat: "dark" });
  kit.box({ sx: 0.04, sy: 0.04, sz: 0.32, x: -0.14, y: 0.14, z: 0.15, mat: "dark" });
  kit.box({ sx: 0.04, sy: 0.04, sz: 0.32, x: 0.14, y: -0.14, z: 0.15, mat: "dark" });
  kit.box({ sx: 0.04, sy: 0.04, sz: 0.32, x: -0.14, y: -0.14, z: 0.15, mat: "dark" });

  // A ball with a fuse on the right.
  kit.sphere({ r: 0.15, x: 0.5, z: 0.15, mat: "glow" });
  kit.cylinder({ r: 0.045, h: 0.04, x: 0.5, z: 0.28, mat: "dark" });
  kit.tube({ points: [[0.5, 0, 0.31], [0.52, -0.02, 0.37], [0.57, -0.03, 0.41], [0.62, -0.01, 0.42]], r: 0.012, mat: "light", segments: 10 });
  kit.sphere({ r: 0.025, x: 0.63, y: -0.01, z: 0.425, mat: "accent" });
}
