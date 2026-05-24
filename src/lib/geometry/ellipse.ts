import { ellipsePoints } from "@/lib/math";
import { SheetPosition } from "@/lib/viewport/types";
import { Id } from "./id";

/** An ellipse defined by its center and two radii.
 * The semi-major axis is horizontal (radiusX).
 * The semi-minor axis is vertical (radiusY). */
export type Ellipse = {
  id: Id;
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
  /** Fill color as a 24-bit integer (0xRRGGBB), or null for no fill. */
  fillColor: number | null;
  /** If true, radiusX and radiusY change together to maintain a circle. */
  linkDimensions: boolean;
  /** Controls rendering order. Higher values render on top of lower values. */
  renderOrder: number;
};

export namespace Ellipse {
  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(ellipse: Ellipse): { perimeter: Array<SheetPosition>, extras: { center: SheetPosition } } {
    const points = ellipsePoints(ellipse);
    return {
      // NOTE: it is very important that perimeter winds counter clockwise, as that is what the DCEL
      // expects.
      perimeter: [points.top, points.right, points.bottom, points.left],

      extras: {
        center: points.center,
      },
    };
  }
}
