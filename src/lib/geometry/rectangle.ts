import { cornersToList, rectCorners } from "@/lib/math";
import { Rect, SheetPosition } from "@/lib/viewport/types";
import { DEFAULT_COLOR } from "./colors";
import { type Id } from "./types";

/** A rectangle defined by its upper-left and lower-right corners. Axis-aligned. */
export type Rectangle = {
  id: Id;
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
  /** Fill color as a 24-bit integer (0xRRGGBB), or null for no fill. */
  fillColor: number | null;
  /** If true, width and height change together to maintain a square. */
  linkDimensions: boolean;
  /** Controls rendering order. Higher values render on top of lower values. */
  renderOrder: number;
};

/** A rectangle without params that will be added by the {@link GeometryStore#addRectangle} method */
export type RectangleTemplate = Omit<Rectangle, 'id' | 'renderOrder'>;

export namespace Rectangle {
  /** Create a new {@link RectangleTemplate} which can be created by {@link GeometryStore#addRectangle}. */
  export function create(
    upperLeft: SheetPosition,
    lowerRight: SheetPosition,
    options?: {
      fillColor?: Rectangle['fillColor'];
      linkDimensions?: Rectangle['linkDimensions'];
    }
  ): RectangleTemplate {
    return {
      upperLeft,
      lowerRight,
      fillColor: options?.fillColor ?? DEFAULT_COLOR,
      linkDimensions: options?.linkDimensions ?? false,
    };
  }

  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(rectangle: Rectangle): { perimeter: Array<SheetPosition>, extras: {} } {
    const rect: Rect<SheetPosition> = {
      position: rectangle.upperLeft,
      width: rectangle.lowerRight.x - rectangle.upperLeft.x,
      height: rectangle.lowerRight.y - rectangle.upperLeft.y,
    };
    return {
      // NOTE: it is very important that perimeter winds counter clockwise, as that is what the DCEL
      // expects.
      perimeter: cornersToList(rectCorners(rect)),
      extras: {},
    };
  }
}
