import { ellipsePoints } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import { DEFAULT_COLOR } from './colors';
import {
  FillColorComponent,
  Geometry,
  GeometryComponent,
  GeometryOmitComponents,
  LinkDimensionsComponent,
  RenderOrderComponent,
} from './types';

/** An ellipse defined by its center and two radii.
 * The semi-major axis is horizontal (radiusX).
 * The semi-minor axis is vertical (radiusY). */
export type Ellipse = Geometry<
  FillColorComponent & LinkDimensionsComponent & RenderOrderComponent & EllipseComponent
>;

/** A ellipse without params that will be added by the {@link GeometryStore#addEllipse} method */
export type EllipseTemplate = Omit<GeometryOmitComponents<Ellipse, RenderOrderComponent>, 'id'>;

/** A point on an ellipse that a constraint endpoint can lock to.
 *  Keys correspond to EllipsePoints keys in math/index.ts. */
export type EllipseEndpoint = 'center' | 'right' | 'left' | 'bottom' | 'top';

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

/**
 * Geometry component containing rendering metadata about an elliptical shaped geometry.
 *
 * A component of {@link Ellipse}, but also could be used by other elliptical shaped geometries if
 * desired. */
export type EllipseComponent = GeometryComponent<
  'ellipse',
  {
    center: SheetPosition;
    radiusX: number;
    radiusY: number;
  }
>;
export namespace EllipseComponent {
  export const key: keyof EllipseComponent = 'ellipse';

  export function create(
    center: SheetPosition,
    args: { radiusX: number; radiusY: number },
  ): EllipseComponent {
    return {
      ellipse: { center, radiusX: args.radiusX, radiusY: args.radiusY },
    };
  }

  export function get(
    geometry: Geometry<EllipseComponent>,
  ): EllipseComponent[keyof EllipseComponent] {
    return geometry.components.ellipse;
  }

  export function update<G extends Geometry<EllipseComponent>>(
    geometry: G,
    ellipse: Partial<EllipseComponent[keyof EllipseComponent]>,
  ): G {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        ellipse: { ...geometry.components.ellipse, ...ellipse },
      },
    };
  }

  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(geometry: Geometry<EllipseComponent>): {
    perimeter: Array<SheetPosition>;
    extras: { center: SheetPosition };
  } {
    const ellipse = EllipseComponent.get(geometry);
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
