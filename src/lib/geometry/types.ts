import { SheetPosition } from "../viewport/types";
import { PolygonSegment } from "./polygon";

/** A stable unique identifier for a shape. */
export type Id = string;

export type Geometry<Components extends {} = {}> = {
  id: Id;
  components: Components;
};

export namespace Geometry {
  export function hasComponent<C extends {}>(geometry: Geometry, component: { key: keyof C }): geometry is Geometry<C> {
    return component.key in geometry.components;
  }
}

export type GeometryOmitComponents<G extends Geometry, C> = Omit<G, 'components'> & { components: Omit<G["components"], keyof C> };

type Component<Type extends string, Metadata> = { [key in Type]: Metadata };

export type RenderOrderComponent = Component<'renderOrder', number>;
export namespace RenderOrderComponent {
  export const key: keyof RenderOrderComponent = "renderOrder";

  export function create(renderOrder: number): RenderOrderComponent {
    return { renderOrder };
  }
  export function get(geometry: Geometry<RenderOrderComponent>): number {
    return geometry.components.renderOrder;
  }
  export function update<G extends Geometry<RenderOrderComponent>>(geometry: G, renderOrder: number): G {
    return { ...geometry, components: { ...geometry.components, renderOrder } };
  }
}

export type FillColorComponent = Component<'fillColor', number | null>;
export namespace FillColorComponent {
  export const key: keyof FillColorComponent = "fillColor";

  export function create(fillColor: number | null): FillColorComponent {
    return { fillColor };
  }
  export function get(geometry: Geometry<FillColorComponent>): number | null {
    return geometry.components.fillColor;
  }
  export function update<G extends Geometry<FillColorComponent>>(geometry: G, fillColor: number | null): G {
    return {
      ...geometry,
      components: { ...geometry.components, fillColor },
    };
  }
}

export type LinkDimensionsComponent = Component<'linkDimensions', boolean>;
export namespace LinkDimensionsComponent {
  export const key: keyof LinkDimensionsComponent = "linkDimensions";

  export function create(linkDimensions: boolean): LinkDimensionsComponent {
    return { linkDimensions };
  }
  export function get(geometry: Geometry<LinkDimensionsComponent>): boolean {
    return geometry.components.linkDimensions;
  }
  export function update<G extends Geometry<LinkDimensionsComponent>>(geometry: G, linkDimensions: boolean): G {
    return { ...geometry, components: { ...geometry.components, linkDimensions } };
  }
}

export type PolygonComponent = Component<'polygon', {
  points: Array<PolygonSegment>;
  closed: boolean;
  openAtIndex: number;
}>;
export namespace PolygonComponent {
  export const key: keyof PolygonComponent = "polygon";

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

export type RectangleComponent = Component<'rectangle', {
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
}>;
export namespace RectangleComponent {
  export const key: keyof RectangleComponent = "rectangle";

  export function create(upperLeft: SheetPosition, lowerRight: SheetPosition): RectangleComponent {
    return {
      rectangle: { upperLeft, lowerRight },
    };
  }
}

export type EllipseComponent = Component<'ellipse', {
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
}>;
export namespace EllipseComponent {
  export const key: keyof EllipseComponent = "ellipse";

  export function create(center: SheetPosition, args: { radiusX: number, radiusY: number }): EllipseComponent {
    return {
      ellipse: { center, radiusX: args.radiusX, radiusY: args.radiusY },
    };
  }
}
