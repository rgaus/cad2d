import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { Geometry, GeometryComponent, LayoutState, type ResizeParams } from '../types';

/**
 * Geometry component for a datum — a single anchor point that constraints can lock to.
 * A datum has exactly one position and no edges.
 */
export type DatumComponent = GeometryComponent<'datum', SheetPosition>;

export namespace DatumComponent {
  export const key: keyof DatumComponent = 'datum';

  export function create(position: SheetPosition): DatumComponent {
    return { datum: position };
  }

  export function get(geometry: Geometry<DatumComponent>): SheetPosition {
    return geometry.components.datum;
  }

  export function update(
    geometry: Geometry<DatumComponent>,
    partial: SheetPosition,
  ): Geometry<DatumComponent> {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        datum: partial,
      },
    };
  }

  export function keyPoints(
    geometry: Geometry<DatumComponent>,
  ): KeyPoints<SheetPosition, never, never> {
    return {
      perimeter: [DatumComponent.get(geometry)],
      perimeterLabels: [null],
      extras: {},
    };
  }

  /** Datum has no area — returns a zero-size rect at its position. */
  export function boundingBox(geometry: Geometry<DatumComponent>): Rect<SheetPosition> {
    const p = DatumComponent.get(geometry);
    return { position: p, width: 0, height: 0 };
  }

  export function getLayoutState(geometry: Geometry<DatumComponent>) {
    return { for: 'datum' as const, position: DatumComponent.get(geometry) };
  }

  export function setLayoutState(
    geometry: Geometry<DatumComponent>,
    state: LayoutState,
  ): Geometry<DatumComponent> {
    if (state.for !== 'datum') {
      return geometry;
    }
    return DatumComponent.update(geometry, state.position);
  }

  export function layoutStateTranslate(
    state: ReturnType<typeof getLayoutState>,
    transform: (input: SheetPosition) => SheetPosition,
  ) {
    return { ...state, position: transform(state.position) };
  }

  export function layoutStateEqual(
    a: ReturnType<typeof getLayoutState>,
    b: ReturnType<typeof getLayoutState>,
  ) {
    if (a.for !== 'datum' || b.for !== 'datum') {
      return false;
    }
    return a.position.x === b.position.x && a.position.y === b.position.y;
  }

  /** Datums do not resize. */
  export function layoutStateResize(
    _state: ReturnType<typeof getLayoutState>,
    _params: ResizeParams,
    _originalBBox?: Rect<SheetPosition>,
  ): null {
    return null;
  }
}
