// <What it is, in one line.>
//
// Built in the kind's units around its own pivot (the origin), +Z up,
// -Y forward. A part is modelled where it rests; its pivot is the point it
// turns about, and a clip moves parts by name away from that rest pose.
import type { Item, Kit } from "polystory";

export const ITEM: Item = { kind: "<kind>", id: "<name>", model: "<name>" };

export function build(kit: Kit) {
  kit.box({ sx: 0.5, sy: 0.32, sz: 0.24, z: 0.12, mat: "base" });
  kit.box({ sx: 0.52, sy: 0.34, sz: 0.04, z: 0.02, mat: "dark" });

  // The hinge runs along the back top edge, so the lid turns about it.
  kit.part({ name: "lid", pivot: [0, 0.16, 0.24] }, (k) => {
    k.box({ sx: 0.52, sy: 0.34, sz: 0.08, z: 0.28, mat: "base" });
    k.cylinder({ r: 0.03, h: 0.02, y: -0.17, z: 0.27, rot: [90, 0, 0], mat: "accent" });
  });

  kit.marker({ name: "loot", z: 0.3 });

  kit.clip({ name: "open", duration: 0.6 }, { lid: { rot: [[0, [0, 0, 0]], [0.6, [-105, 0, 0]]], ease: "smooth" } });
  // A loop ends where it starts.
  kit.clip({ name: "idle", duration: 2 }, { lid: { rot: (t) => [-4 * (1 - Math.cos(Math.PI * t)), 0, 0] } });
}
