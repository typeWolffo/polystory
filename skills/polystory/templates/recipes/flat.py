"""<What it is, in one line.>

Built in the kind's units around its own pivot (the origin), +Z up,
-Y forward. The origin is where the code will hold it, not the centre of
its bounds.
"""

ITEM = {
    "kind": "<kind>",
    "id": "<name>",
    "model": "<name>",
}


def build(kit):
    kit.sphere(r=0.2, mat="base")
    kit.cylinder(r=0.07, h=0.06, z=0.17, mat="dark")
