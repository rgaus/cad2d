import { SheetPosition } from '../viewport/types';
import { DEFAULT_COLOR } from './colors';
import type { Ellipse } from './ellipse';
import { PolygonSegment } from './polygon';
import type { Polygon } from './polygon';
import type { Rectangle } from './rectangle';

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
}

export type GeometryOmitComponents<G extends Geometry, C> = Omit<G, 'components'> & {
  components: Omit<G['components'], keyof C>;
};

type GeometryComponent<Type extends string, Metadata> = { [key in Type]: Metadata };

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

export type PolygonComponent = GeometryComponent<
  'polygon',
  {
    points: Array<PolygonSegment>;
    closed: boolean;
    openAtIndex: number;
  }
>;
export namespace PolygonComponent {
  export const key: keyof PolygonComponent = 'polygon';

  export function create(
    points: Array<PolygonSegment>,
    options?: { closed?: boolean; openAtIndex?: number },
  ): PolygonComponent {
    if (points.length < 2) {
      throw new Error(
        `PolygonComponent.create: points.length must be >= 2, found ${points.length}`,
      );
    }
    return {
      polygon: {
        points,
        closed: options?.closed ?? points[0].point === points.at(-1)!.point,
        openAtIndex: options?.openAtIndex ?? 0,
      },
    };
  }

  export function get(
    geometry: Geometry<PolygonComponent>,
  ): PolygonComponent[keyof PolygonComponent] {
    return geometry.components.polygon;
  }

  export function update<G extends Geometry<PolygonComponent>>(
    geometry: G,
    polygon: Partial<PolygonComponent[keyof PolygonComponent]>,
  ): G {
    const merged = { ...geometry.components.polygon, ...polygon };
    merged.openAtIndex = Math.max(0, Math.min(merged.openAtIndex, merged.points.length - 1));

    let components: any = {
      ...geometry.components,
      polygon: merged,
    };

    // Add / remove fill color based on polygon closed state
    if (merged.closed && !FillColorComponent.has(geometry)) {
      components = { ...components, ...FillColorComponent.create(DEFAULT_COLOR) };
    } else if (!merged.closed && FillColorComponent.has(geometry)) {
      components = FillColorComponent.remove(geometry);
    }

    return { ...geometry, components };
  }

  export function openPath<G extends Geometry<PolygonComponent>>(geometry: G): G {
    const polygon = PolygonComponent.get(geometry);
    if (!polygon.closed || polygon.points.length < 3) {
      return geometry;
    }
    return PolygonComponent.update(geometry, {
      points: [
        ...polygon.points.slice(
          polygon.openAtIndex + 1,
          -1 /* remove closed mode "duplicate" point */,
        ),
        ...polygon.points.slice(0, polygon.openAtIndex + 1),
      ],
      closed: false,
    });
  }

  export function closePath<G extends Geometry<PolygonComponent>>(geometry: G): G {
    const polygonData = PolygonComponent.get(geometry);
    if (polygonData.closed || polygonData.points.length < 3) {
      return geometry;
    }

    const splitAt = polygonData.points.length - (polygonData.openAtIndex + 1);
    return PolygonComponent.update(geometry, {
      points: [
        ...polygonData.points.slice(splitAt),
        ...polygonData.points.slice(0, splitAt),
        // Add back in final "closing" point
        { type: 'point', point: polygonData.points[splitAt].point },
      ],
      closed: true,
    });
  }
}

export type RectangleComponent = GeometryComponent<
  'rectangle',
  {
    upperLeft: SheetPosition;
    lowerRight: SheetPosition;
  }
>;
export namespace RectangleComponent {
  export const key: keyof RectangleComponent = 'rectangle';

  export function create(upperLeft: SheetPosition, lowerRight: SheetPosition): RectangleComponent {
    return {
      rectangle: { upperLeft, lowerRight },
    };
  }

  export function get(
    geometry: Geometry<RectangleComponent>,
  ): RectangleComponent[keyof RectangleComponent] {
    return geometry.components.rectangle;
  }

  export function update<G extends Geometry<RectangleComponent>>(
    geometry: G,
    rectangle: Partial<RectangleComponent[keyof RectangleComponent]>,
  ): G {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        rectangle: { ...geometry.components.rectangle, ...rectangle },
      },
    };
  }
}

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
}

/** Type guard: true if geometry has a PolygonComponent. */
export function isPolygon(g: Geometry): g is Polygon {
  return Geometry.hasComponent(g, PolygonComponent);
}
