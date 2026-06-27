import { SheetPosition } from '@/lib/viewport/types';
import { DatumComponent } from './components/DatumComponent';
import { RenderOrderComponent } from './components/RenderOrderComponent';
import { Geometry, GeometryOmitComponents } from './types';

/** A datum — a single anchor point that constraints can lock to. */
export type Datum = Geometry<DatumComponent & RenderOrderComponent>;

/** A datum without an id or renderOrder that will be assigned by GeometryStore. */
export type DatumTemplate = Omit<GeometryOmitComponents<Datum, RenderOrderComponent>, 'id'>;

/** Fixed pixel radius of the circle rendered around a datum's center crosshair. */
export const DATUM_CIRCLE_RADIUS_PX = 8;

export namespace Datum {
  export function create(
    position: SheetPosition,
    options?: { renderOrder?: number },
  ): DatumTemplate {
    return {
      components: {
        ...DatumComponent.create(position),
        ...RenderOrderComponent.create(options?.renderOrder ?? 0),
      },
    };
  }
}
