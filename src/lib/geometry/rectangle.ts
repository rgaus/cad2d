import { cornersToList, rectCorners } from '@/lib/math';
import { Rect, SheetPosition } from '@/lib/viewport/types';
import { DEFAULT_COLOR } from './colors';
import {
  FillColorComponent,
  Geometry,
  GeometryComponent,
  GeometryOmitComponents,
  LinkDimensionsComponent,
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

/**
 * Geometry component containing rendering metadata about a rectangular shaped geometry.
 *
 * A component of Rectangle, but also could be used by other rectangular shaped geometries if
 * desired. */
export type RectangleComponent = GeometryComponent<
  'rectangle',
  {
    upperLeft: SheetPosition;
    lowerRight: SheetPosition;
  }
>;
export namespace RectangleComponent {
  export const key: keyof RectangleComponent = 'rectangle';

  export function create(upperLeft: SheetPosition, lowerRight: SheetPosition): RectangleComponent {
    return {
      rectangle: { upperLeft, lowerRight },
    };
  }

  export function get(
    geometry: Geometry<RectangleComponent>,
  ): RectangleComponent[keyof RectangleComponent] {
    return geometry.components.rectangle;
  }

  export function update<G extends Geometry<RectangleComponent>>(
    geometry: G,
    rectangle: Partial<RectangleComponent[keyof RectangleComponent]>,
  ): G {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        rectangle: { ...geometry.components.rectangle, ...rectangle },
      },
    };
  }

  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(geometry: Geometry<RectangleComponent>): {
    perimeter: Array<SheetPosition>;
    extras: {};
  } {
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
}
