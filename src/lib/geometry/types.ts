import { PolygonSegment } from "./polygon";

/** A stable unique identifier for a shape. */
export type Id = string;

export type Geometry<Components extends {} = {}> = {
  id: Id;
  components: Components;
};

export type GeometryOmitComponents<G extends Geometry, C> = Omit<G, 'components'> & { components: Omit<G["components"], keyof C> };

type Component<Type extends string, Metadata> = { [key in Type]: Metadata };

export type RenderOrderComponent = Component<'renderOrder', number>;
export namespace RenderOrderComponent {
  export function create(renderOrder: number): RenderOrderComponent {
    return { renderOrder };
  }
  export function get(geometry: Geometry<RenderOrderComponent>): number {
    return geometry.components.renderOrder;
  }
  export function set<G extends Geometry<RenderOrderComponent>>(geometry: G, renderOrder: number): G {
    return { ...geometry, components: { ...geometry.components, renderOrder } };
  }
}

export type FillColorComponent = Component<'fillColor', number | null>;
export namespace FillColorComponent {
  export function create(fillColor: number | null): FillColorComponent {
    return { fillColor };
  }
  export function get(geometry: Geometry<FillColorComponent>): number | null {
    return geometry.components.fillColor;
  }
  export function set<G extends Geometry<FillColorComponent>>(geometry: G, fillColor: number | null): G {
    return { ...geometry, components: { ...geometry.components, fillColor } };
  }
}

export type PolygonComponent = Component<'polygon', {
  points: Array<PolygonSegment>;
  closed: boolean;
  openAtIndex: number;
}>;
export namespace PolygonComponent {
  export function create(points: Array<PolygonSegment>, options?: { closed?: boolean, openAtIndex?: number }): PolygonComponent {
    if (points.length < 2) {
      throw new Error(`PolygonComponent.create: points.length must be >= 2, found ${points.length}`);
    }
    return {
      polygon: {
        points,
        closed: options?.closed ?? (points[0].point === points.at(-1)!.point),
        openAtIndex: options?.openAtIndex ?? 0,
      },
    };
  }
}
