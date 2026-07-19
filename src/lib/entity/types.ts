import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { DatumComponent } from './components/DatumComponent';
import { GeometryComponent } from './components/GeometryComponent';
import { EllipseData } from './geometry/ellipse';
import { PolygonData } from './geometry/polygon';
import { RectangleData } from './geometry/rectangle';

/** A stable unique identifier for a shape. */
export type Id = string;

export type Entity<Components extends {} = {}> = {
  id: Id;
  components: Components;
};

export namespace Entity {
  export function hasComponent<C extends {}>(
    geometry: Entity,
    component: { key: keyof C },
  ): geometry is Entity<C>;
  export function hasComponent<C extends {}>(
    geometries: Array<Entity>,
    component: { key: keyof C },
  ): boolean;
  export function hasComponent<C extends {}>(
    geometryOrArray: Entity | Array<Entity>,
    component: { key: keyof C },
  ): boolean {
    const geometries = Array.isArray(geometryOrArray) ? geometryOrArray : [geometryOrArray];
    return geometries.every((g) => component.key in g.components);
  }

  export function hasComponents<A extends {}, B extends {}>(
    geometry: Entity,
    a: { key: keyof A },
    b: { key: keyof B },
  ): geometry is Entity<A & B>;
  export function hasComponents<A extends {}, B extends {}, C extends {}>(
    geometry: Entity,
    a: { key: keyof A },
    b: { key: keyof B },
    c: { key: keyof C },
  ): geometry is Entity<A & B & C>;
  export function hasComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    geometry: Entity,
    a: { key: keyof A },
    b: { key: keyof B },
    c: { key: keyof C },
    d: { key: keyof D },
  ): geometry is Entity<A & B & C & D>;
  export function hasComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    geometry: Entity,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
    c?: { readonly key: keyof C },
    d?: { readonly key: keyof D },
  ): boolean {
    return (
      a.key in geometry.components &&
      b.key in geometry.components &&
      (!c || (c.key as string) in geometry.components) &&
      (!d || (d.key as string) in geometry.components)
    );
  }

  /** Given a {@link Entity} with a given component, generate an entity with exclusively that
   * component. Very similar in concept to Pick<{ a: 1, b: 2}, 'a'> */
  export function pickComponent<C extends {}, O extends {}>(
    entity: Entity<C & O>,
    component: { readonly key: keyof C },
  ): Entity<C> {
    return {
      ...entity,
      components: {
        [component.key]: entity.components[component.key],
      } as C,
    };
  }

  /** Given a {@link Entity} and a given component that another {@link Entity} contains, take the
   * value of the component from the first entity and copy it into the second. Conceptually similar
   * to Object.assign(entity, source). */
  export function assignComponent<C extends {}, O extends {}>(
    entity: Entity<O>,
    component: { readonly key: keyof C },
    source: Entity<C>,
  ): Entity<C & O> {
    return {
      ...entity,
      components: {
        ...entity.components,
        [component.key]: source.components[component.key],
      } as O & C,
    };
  }

  export function keyPoints(
    geometry: Entity<GeometryComponent<PolygonData>>,
  ): ReturnType<typeof PolygonData.keyPoints>;
  export function keyPoints(
    geometry: Entity<GeometryComponent<RectangleData>>,
  ): ReturnType<typeof PolygonData.keyPoints>;
  export function keyPoints(
    geometry: Entity<GeometryComponent<EllipseData>>,
  ): ReturnType<typeof EllipseData.keyPoints>;
  export function keyPoints(
    geometry: Entity<DatumComponent>,
  ): ReturnType<typeof DatumComponent.keyPoints>;
  export function keyPoints(geometry: Entity): KeyPoints<SheetPosition, any> {
    if (Entity.hasComponent(geometry, GeometryComponent)) {
      return GeometryComponent.keyPoints(geometry as Entity<GeometryComponent>);
    } else if (Entity.hasComponent(geometry, DatumComponent)) {
      return DatumComponent.keyPoints(geometry);
    }
    throw new Error(`Geometry.keyPoints: unknown geometry type for id=${geometry.id}`);
  }

  export function boundingBox(geometry: Entity): Rect<SheetPosition> {
    if (Entity.hasComponent(geometry, GeometryComponent)) {
      return GeometryComponent.boundingBox(geometry as Entity<GeometryComponent>);
    } else if (Entity.hasComponent(geometry, DatumComponent)) {
      return DatumComponent.boundingBox(geometry);
    }
    throw new Error(`Geometry.boundingBox: unknown geometry type for id=${geometry.id}`);
  }
}

export type EntityOmitComponents<G extends Entity, C> = Omit<G, 'components'> & {
  components: Omit<G['components'], keyof C>;
};

/** Ensure that the given set of components are assigned to `never`, so they cannot be passed in. */
export type EntityNeverComponents<G extends Entity, C> = Omit<G, 'components'> & {
  components: Omit<G['components'], keyof C> & { [key in keyof C]: never };
};

export type EntityComponent<Type extends string, Metadata> = { [key in Type]: Metadata };

/** Corner being dragged during shape resize. */
export type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Edge being dragged during shape resize. */
export type ResizeEdge = 'top' | 'bottom' | 'left' | 'right';

/** Resize mode indicating which handle is being dragged. */
export type ResizeMode =
  | { type: 'corner'; corner: ResizeCorner }
  | { type: 'edge'; edge: ResizeEdge };

/** Parameters for performing a per-geometry resize via LayoutState.resize. */
export type ResizeParams = {
  to: SheetPosition;
  mode: ResizeMode;
  altHeld: boolean;
  shiftHeld: boolean;
  linkDimensions: boolean;
};
