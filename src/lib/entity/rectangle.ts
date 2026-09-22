import { type KeyPointKeys, type SheetPosition } from '@/lib/viewport/types';
import { DEFAULT_COLOR } from './colors';
import { FillColorComponent } from './components/FillColorComponent';
import { GeometryComponent } from './components/GeometryComponent';
import { LinkDimensionsComponent } from './components/LinkDimensionsComponent';
import { RenderOrderComponent } from './components/RenderOrderComponent';
import { RectangleData } from './geometry/rectangle';
import { Entity, EntityOmitComponents } from './types';

/** A rectangle defined by its upper-left and lower-right corners. Axis-aligned. */
export type Rectangle = Entity<
  GeometryComponent<RectangleData> &
    LinkDimensionsComponent &
    FillColorComponent &
    RenderOrderComponent
>;

/** A rectangle without params that will be added by the {@link GeometryStore#addRectangle} method */
export type RectangleTemplate = Omit<EntityOmitComponents<Rectangle, RenderOrderComponent>, 'id'>;

export type RectangleCorner = 'upperLeft' | 'upperRight' | 'lowerRight' | 'lowerLeft';

export namespace RectangleCorner {
  /** Attempts to cast the given passed string into a {@link RectangleCorner} */
  export function is(input: any): input is RectangleCorner {
    if (typeof input !== 'string') {
      return false;
    }
    return ['upperLeft', 'upperRight', 'lowerRight', 'lowerLeft'].includes(input);
  }
}

/** A point on a rectangle that a constraint endpoint can lock to.
 *  Derived from {@link GeometryComponent.keyPoints} -> {@link RectangleData.keyPoints}. */
export type RectangleEndpoint = KeyPointKeys<ReturnType<typeof RectangleData.keyPoints>>;

export namespace RectangleEndpoint {
  /** Attempts to cast the given passed string into a {@link RectangleEndpoint} */
  export function is(input: any): input is RectangleEndpoint {
    if (typeof input !== 'string') {
      return false;
    }
    return RectangleCorner.is(input) || input === 'center';
  }

  /** A list of all rectangle endpoint corners, in CCW order starting at `upperLeft`. */
  export const CORNERS: Array<RectangleEndpoint> = [
    'upperLeft',
    'upperRight',
    'lowerRight',
    'lowerLeft',
  ];

  /** A list of all rectangle endpoint values, including corners and center. */
  export const LIST: Array<RectangleEndpoint> = [...RectangleEndpoint.CORNERS, 'center'];
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
        ...GeometryComponent.createRectangle(upperLeft, lowerRight),
        ...LinkDimensionsComponent.create(options?.linkDimensions ?? false),
        ...FillColorComponent.create(typeof fillColor !== 'undefined' ? fillColor : DEFAULT_COLOR),
      },
    };
  }
}
