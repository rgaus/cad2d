import { cornersToList, rectCorners } from '@/lib/math';
import { Rect, SheetPosition } from '@/lib/viewport/types';
import { DEFAULT_COLOR } from './colors';
import {
  FillColorComponent,
  Geometry,
  GeometryOmitComponents,
  LinkDimensionsComponent,
  RectangleComponent,
  RenderOrderComponent,
} from './types';

/** A rectangle defined by its upper-left and lower-right corners. Axis-aligned. */
export type Rectangle = Geometry<
  RectangleComponent & LinkDimensionsComponent & FillColorComponent & RenderOrderComponent
>;

/** A rectangle without params that will be added by the {@link GeometryStore#addRectangle} method */
export type RectangleTemplate = Omit<GeometryOmitComponents<Rectangle, RenderOrderComponent>, 'id'>;

/** A point on a rectangle that a constraint endpoint can lock to.
 *  Keys correspond to RectCorners keys in viewport/types.ts. */
export type RectangleEndpoint = 'upperLeft' | 'upperRight' | 'lowerLeft' | 'lowerRight';

export namespace Rectangle {
  /** Create a new {@link RectangleTemplate} which can be created by {@link GeometryStore#addRectangle}. */
  export function create(
    upperLeft: SheetPosition,
    lowerRight: SheetPosition,
    options?: {
      fillColor?: number | null;
      linkDimensions?: boolean;
    },
  ): RectangleTemplate {
    const fillColor = options?.fillColor;
    return {
      components: {
        ...RectangleComponent.create(upperLeft, lowerRight),
        ...LinkDimensionsComponent.create(options?.linkDimensions ?? false),
        ...FillColorComponent.create(typeof fillColor !== 'undefined' ? fillColor : DEFAULT_COLOR),
      },
    };
  }

  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(geometry: Rectangle): { perimeter: Array<SheetPosition>; extras: {} } {
    const rectangle = RectangleComponent.get(geometry);
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
