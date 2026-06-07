import { KeyPoints, Rect, SheetPosition } from '../viewport/types';
import { EllipseComponent } from './ellipse';
import { PolygonComponent, PolygonSegment } from './polygon';
import type { Polygon } from './polygon';
import { RectangleComponent } from './rectangle';

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

/** Controls rendering order. Higher values render on top of lower values. */
export type RenderOrderComponent = GeometryComponent<'renderOrder', number>;

export namespace RenderOrderComponent {
  export const key: keyof RenderOrderComponent = 'renderOrder';

  export function create(renderOrder: number): RenderOrderComponent {
    return { renderOrder };
  }
  export function get(geometry: Geometry<RenderOrderComponent>): number {
    return geometry.components.renderOrder;
  }
  export function update<G extends Geometry<RenderOrderComponent>>(
    geometry: G,
    renderOrder: number,
  ): G {
    return { ...geometry, components: { ...geometry.components, renderOrder } };
  }
  /** Remove a given {@link RenderOrderComponent} from a given {@link Geometry}. */
  export function remove<G extends Geometry<RenderOrderComponent>>(
    geometry: G,
  ): GeometryOmitComponents<G, RenderOrderComponent> {
    const components: Partial<G['components']> = { ...geometry.components };
    delete components.renderOrder;
    return { ...geometry, components };
  }
}

/** Fill color as a 24-bit integer (0xRRGGBB), or null for no fill. */
export type FillColorComponent = GeometryComponent<'fillColor', number | null>;

export namespace FillColorComponent {
  export const key: keyof FillColorComponent = 'fillColor';

  export function create(fillColor: number | null): FillColorComponent {
    return { fillColor };
  }

  /** Get the value of the {@link FillColorComponent} from a given {@link Geometry}. */
  export function get(geometry: Geometry<FillColorComponent>): number | null {
    return geometry.components.fillColor;
  }
  /** Get the value of the {@link FillColorComponent} from a given {@link Geometry} which may or may not have that component. Returns undefined if the component is missing. */
  export function getOptional(geometry: Geometry): number | null | undefined {
    if (Geometry.hasComponent(geometry, FillColorComponent)) {
      return geometry.components.fillColor;
    } else {
      return undefined;
    }
  }
  export function has(geometry: Geometry): geometry is Geometry<FillColorComponent> {
    return 'fillColor' in Geometry;
  }
  /** Update the given value of the {@link FillColorComponent} for a given {@link Geometry}. */
  export function update<G extends Geometry<FillColorComponent>>(
    geometry: G,
    fillColor: number | null,
  ): G {
    return {
      ...geometry,
      components: { ...geometry.components, fillColor },
    };
  }
  /** Remove a given {@link FillColorComponent} from a given {@link Geometry}. */
  export function remove<G extends Geometry<FillColorComponent>>(
    geometry: G,
  ): GeometryOmitComponents<G, FillColorComponent> {
    const components: Partial<G['components']> = { ...geometry.components };
    delete components.fillColor;
    return { ...geometry, components };
  }
}

/** If true, width and height change together to maintain a circle/square. */
export type LinkDimensionsComponent = GeometryComponent<'linkDimensions', boolean>;

export namespace LinkDimensionsComponent {
  export const key: keyof LinkDimensionsComponent = 'linkDimensions';

  export function create(linkDimensions: boolean): LinkDimensionsComponent {
    return { linkDimensions };
  }
  export function get(geometry: Geometry<LinkDimensionsComponent>): boolean {
    return geometry.components.linkDimensions;
  }
  export function update<G extends Geometry<LinkDimensionsComponent>>(
    geometry: G,
    linkDimensions: boolean,
  ): G {
    return { ...geometry, components: { ...geometry.components, linkDimensions } };
  }
}
