import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { EllipseComponent } from './components/EllipseComponent';
import { PolygonComponent } from './components/PolygonComponent';
import { RectangleComponent } from './components/RectangleComponent';

/** A stable unique identifier for a shape. */
export type Id = string;

export type Geometry<Components extends {} = {}> = {
  id: Id;
  components: Components;
};

export namespace Geometry {
  export function hasComponent<C extends {}>(
    geometry: Geometry,
    component: { key: keyof C },
  ): geometry is Geometry<C>;
  export function hasComponent<C extends {}>(
    geometries: Array<Geometry>,
    component: { key: keyof C },
  ): boolean;
  export function hasComponent<C extends {}>(
    geometryOrArray: Geometry | Array<Geometry>,
    component: { key: keyof C },
  ): boolean {
    const geometries = Array.isArray(geometryOrArray) ? geometryOrArray : [geometryOrArray];
    return geometries.every((g) => component.key in g.components);
  }

  export function hasComponents<A extends {}, B extends {}>(
    geometry: Geometry,
    a: { key: keyof A },
    b: { key: keyof B },
  ): geometry is Geometry<A & B>;
  export function hasComponents<A extends {}, B extends {}, C extends {}>(
    geometry: Geometry,
    a: { key: keyof A },
    b: { key: keyof B },
    c: { key: keyof C },
  ): geometry is Geometry<A & B & C>;
  export function hasComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    geometry: Geometry,
    a: { key: keyof A },
    b: { key: keyof B },
    c: { key: keyof C },
    d: { key: keyof D },
  ): geometry is Geometry<A & B & C & D>;
  export function hasComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    geometry: Geometry,
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

  export function keyPoints<Extras extends string = never>(
    geometry: Geometry,
  ): KeyPoints<SheetPosition, Extras> {
    if (Geometry.hasComponent(geometry, PolygonComponent)) {
      return PolygonComponent.keyPoints(geometry) as KeyPoints<SheetPosition, Extras>;
    } else if (Geometry.hasComponent(geometry, EllipseComponent)) {
      return EllipseComponent.keyPoints(geometry) as KeyPoints<SheetPosition, Extras>;
    } else if (Geometry.hasComponent(geometry, RectangleComponent)) {
      return RectangleComponent.keyPoints(geometry) as KeyPoints<SheetPosition, Extras>;
    }
    throw new Error(`Geometry.keyPoints: unknown geometry type for id=${geometry.id}`);
  }

  export function boundingBox(geometry: Geometry): Rect<SheetPosition> {
    if (Geometry.hasComponent(geometry, PolygonComponent)) {
      return PolygonComponent.boundingBox(geometry);
    } else if (Geometry.hasComponent(geometry, EllipseComponent)) {
      return EllipseComponent.boundingBox(geometry);
    } else if (Geometry.hasComponent(geometry, RectangleComponent)) {
      return RectangleComponent.boundingBox(geometry);
    }
    throw new Error(`Geometry.boundingBox: unknown geometry type for id=${geometry.id}`);
  }
}

export type GeometryOmitComponents<G extends Geometry, C> = Omit<G, 'components'> & {
  components: Omit<G['components'], keyof C>;
};

/** Ensure that the given set of components are assigned to `never`, so they cannot be passed in. */
export type GeometryNeverComponents<G extends Geometry, C> = Omit<G, 'components'> & {
  components: Omit<G['components'], keyof C> & { [key in keyof C]: never };
};

export type GeometryComponent<Type extends string, Metadata> = { [key in Type]: Metadata };
