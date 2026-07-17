import { type KeyPointKeys, type SheetPosition } from '@/lib/viewport/types';
import { DEFAULT_COLOR } from './colors';
import { EllipseComponent } from './components/EllipseComponent';
import { FillColorComponent } from './components/FillColorComponent';
import { LinkDimensionsComponent } from './components/LinkDimensionsComponent';
import { RenderOrderComponent } from './components/RenderOrderComponent';
import { Entity, EntityOmitComponents } from './types';

/** An ellipse defined by its center and two radii.
 * The semi-major axis is horizontal (radiusX).
 * The semi-minor axis is vertical (radiusY). */
export type Ellipse = Entity<
  FillColorComponent & LinkDimensionsComponent & RenderOrderComponent & EllipseComponent
>;

/** A ellipse without params that will be added by the {@link GeometryStore#addEllipse} method */
export type EllipseTemplate = Omit<EntityOmitComponents<Ellipse, RenderOrderComponent>, 'id'>;

/** A point on an ellipse that a constraint endpoint can lock to.
 *  Derived from {@link EllipseComponent.keyPoints}. */
export type EllipseEndpoint = KeyPointKeys<ReturnType<typeof EllipseComponent.keyPoints>>;

export namespace Ellipse {
  /** Create a new {@link EllipseTemplate} which can be created by {@link GeometryStore#addEllipse}. */
  export function create(
    center: SheetPosition,
    args: {
      radiusX: number;
      radiusY: number;
      fillColor?: number | null;
      linkDimensions?: boolean;
    },
  ): EllipseTemplate {
    const fillColor = args?.fillColor;
    return {
      components: {
        ...EllipseComponent.create(center, { radiusX: args.radiusX, radiusY: args.radiusY }),
        ...LinkDimensionsComponent.create(args?.linkDimensions ?? false),
        ...FillColorComponent.create(typeof fillColor !== 'undefined' ? fillColor : DEFAULT_COLOR),
      },
    };
  }
}
