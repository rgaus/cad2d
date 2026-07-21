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

/** A point on a rectangle that a constraint endpoint can lock to.
 *  Derived from {@link GeometryComponent.keyPoints} -> {@link RectangleData.keyPoints}. */
export type RectangleEndpoint = KeyPointKeys<ReturnType<typeof RectangleData.keyPoints>>;

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
