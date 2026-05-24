import { SheetPosition } from "@/lib/viewport/types";
import { Rectangle, RectangleEndpoint } from "../rectangle";
import { Ellipse, EllipseEndpoint } from "../ellipse";
import { Polygon } from "../polygon";
import { type Id } from "../types";

/** An endpoint of a linear constraint. Can be a free-floating point, or locked to a specific
 *  point on a rectangle, ellipse, or polygon. When locked, the constraint automatically follows
 *  the geometry when it moves. */
export type ConstraintEndpoint =
  | { type: "point"; point: SheetPosition }
  | { type: "locked-rectangle"; id: Id; point: RectangleEndpoint }
  | { type: "locked-ellipse"; id: Id; point: EllipseEndpoint }
  | { type: "locked-polygon"; id: Id; pointIndex: number };

export namespace ConstraintEndpoint {
  export function point(point: SheetPosition): ConstraintEndpoint {
    return { type: "point", point };
  }
  export function lockedToRectangle(id: Rectangle["id"], point: RectangleEndpoint): ConstraintEndpoint {
    return { type: "locked-rectangle", id, point };
  }
  export function lockedToEllipse(id: Ellipse["id"], point: EllipseEndpoint): ConstraintEndpoint {
    return { type: "locked-ellipse", id, point };
  }
  export function lockedToPolygon(id: Polygon["id"], pointIndex: number): ConstraintEndpoint {
    return { type: "locked-polygon", id, pointIndex };
  }

  /** Deep equality check for two ConstraintEndpoint values. */
  export function equal(a: ConstraintEndpoint, b: ConstraintEndpoint): boolean {
    if (a.type !== b.type) {
      return false;
    }
    switch (a.type) {
      case "point":
        return b.type === "point" && a.point.x === b.point.x && a.point.y === b.point.y;
      case "locked-rectangle":
        return b.type === "locked-rectangle" && a.id === b.id && a.point === b.point;
      case "locked-ellipse":
        return b.type === "locked-ellipse" && a.id === b.id && a.point === b.point;
      case "locked-polygon":
        return b.type === "locked-polygon" && a.id === b.id && a.pointIndex === b.pointIndex;
    }
  }
};
