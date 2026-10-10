// <What it is, in one line.>
//
// Built in the slot's socket frame: z = 0 is <what the socket marks>, +Z up,
// -Y forward. Sizes come from .polystory/style.md, not from guesswork.
import type { Item, Kit } from "polystory";

export const ITEM: Item = {
  kind: "<kind>",
  id: "<slot>_<name>",
  slot: "<slot>",
  model: "<folder>/<name>",
};

export function build(kit: Kit) {
  // One dominant mass and one accent. Every call takes a palette material.
  kit.cylinder({ r: 0.6, h: 0.4, mat: "base" });
  kit.torus({ R: 0.6, r: 0.03, z: 0.1, mat: "accent" });
}
