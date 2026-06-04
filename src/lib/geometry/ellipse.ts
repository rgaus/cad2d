import { ellipsePoints } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import { DEFAULT_COLOR } from './colors';
import { EllipseComponent, FillColorComponent, Geometry, GeometryOmitComponents, Id, LinkDimensionsComponent, RenderOrderComponent } from './types';

/** An ellipse defined by its center and two radii.
 * The semi-major axis is horizontal (radiusX).
 * The semi-minor axis is vertical (radiusY). */
export type Ellipse = Geometry<FillColorComponent & LinkDimensionsComponent & RenderOrderComponent & EllipseComponent> & {
  id: Id;
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
  /** If true, radiusX and radiusY change together to maintain a circle. */
  linkDimensions: boolean;
};

/** A ellipse without params that will be added by the {@link GeometryStore#addEllipse} method */
export type EllipseTemplate = Omit<GeometryOmitComponents<Ellipse, RenderOrderComponent>, 'id' | 'renderOrder'>;

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
      linkDimensions?: Ellipse['linkDimensions'];
    },
  ): EllipseTemplate {
    const fillColor = args?.fillColor;
    return {
      center,
      radiusX: args.radiusX,
      radiusY: args.radiusY,
      linkDimensions: args?.linkDimensions ?? false,
      components: {
        ...FillColorComponent.create(typeof fillColor !== 'undefined' ? fillColor : DEFAULT_COLOR),
        ...LinkDimensionsComponent.create(args?.linkDimensions ?? false),
        ...EllipseComponent.create(center, { radiusX: args.radiusX, radiusY: args.radiusY }),
      }
    };
  }

  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(ellipse: Ellipse): {
    perimeter: Array<SheetPosition>;
    extras: { center: SheetPosition };
  } {
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
