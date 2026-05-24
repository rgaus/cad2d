import { SheetPosition } from "@/lib/viewport/types";
import { Id } from "../id";

/** A point on a rectangle that a constraint endpoint can lock to.
 *  Keys correspond to RectCorners keys in viewport/types.ts. */
export type RectangleEndpoint =
  | "upperLeft"
  | "upperRight"
  | "lowerLeft"
  | "lowerRight";

/** A point on an ellipse that a constraint endpoint can lock to.
 *  Keys correspond to EllipsePoints keys in math/index.ts. */
export type EllipseEndpoint =
  | "center"
  | "right"
  | "left"
  | "bottom"
  | "top";

/** An endpoint of a linear constraint. Can be a free-floating point, or locked to a specific
 *  point on a rectangle, ellipse, or polygon. When locked, the constraint automatically follows
 *  the geometry when it moves. */
export type ConstraintEndpoint =
  | { type: "point"; point: SheetPosition }
  | { type: "locked-rectangle"; id: Id; point: RectangleEndpoint }
  | { type: "locked-ellipse"; id: Id; point: EllipseEndpoint }
  | { type: "locked-polygon"; id: Id; pointIndex: number };
