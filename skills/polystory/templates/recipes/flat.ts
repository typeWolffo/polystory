// <What it is, in one line.>
//
// Built in the kind's units around its own pivot (the origin), +Z up,
// -Y forward. The origin is where the code will hold it, not the centre of
// its bounds.
import type { Item, Kit } from "polystory";

export const ITEM: Item = { kind: "<kind>", id: "<name>", model: "<name>" };

export function build(kit: Kit) {
  kit.sphere({ r: 0.2, mat: "base" });
  kit.cylinder({ r: 0.07, h: 0.06, z: 0.17, mat: "dark" });
}
