import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { Entity, EntityComponent, type ResizeParams } from '../types';

/**
 * Geometry component for a datum — a single anchor point that constraints can lock to.
 * A datum has exactly one position and no edges.
 */
export type DatumComponent = EntityComponent<'datum', SheetPosition>;

export namespace DatumComponent {
  export const key: keyof DatumComponent = 'datum';

  export function create(position: SheetPosition): DatumComponent {
    return { datum: position };
  }

  export function get(geometry: Entity<DatumComponent>): SheetPosition {
    return geometry.components.datum;
  }

  export function update(
    geometry: Entity<DatumComponent>,
    partial: SheetPosition,
  ): Entity<DatumComponent> {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        datum: partial,
      },
    };
  }

  export function keyPoints(
    geometry: Entity<DatumComponent>,
  ): KeyPoints<SheetPosition, never, never> {
    return {
      perimeter: [DatumComponent.get(geometry)],
      perimeterLabels: [null],
      extras: {},
    };
  }

  /** Datum has no area — returns a zero-size rect at its position. */
  export function boundingBox(geometry: Entity<DatumComponent>): Rect<SheetPosition> {
    const p = DatumComponent.get(geometry);
    return { position: p, width: 0, height: 0 };
  }

  export function getLayoutState(geometry: Entity<DatumComponent>) {
    return { for: 'datum' as const, position: DatumComponent.get(geometry) };
  }

  export function translate(
    state: Entity<DatumComponent>,
    transform: (input: SheetPosition) => SheetPosition,
  ) {
    return DatumComponent.update(state, transform(DatumComponent.get(state)));
  }

  export function getOrigin(entity: Entity<DatumComponent>): SheetPosition {
    return DatumComponent.get(entity);
  }

  export function equals(a: Entity<DatumComponent>, b: Entity<DatumComponent>) {
    const aPosition = DatumComponent.get(a);
    const bPosition = DatumComponent.get(b);
    return aPosition.x === bPosition.x && aPosition.y === bPosition.y;
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
