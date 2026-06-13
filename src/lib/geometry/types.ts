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

  export function getLayoutState(geometry: Geometry) {
    if (Geometry.hasComponent(geometry, EllipseComponent)) {
      return EllipseComponent.getLayoutState(geometry);
    } else if (Geometry.hasComponent(geometry, RectangleComponent)) {
      return RectangleComponent.getLayoutState(geometry);
    } else if (Geometry.hasComponent(geometry, PolygonComponent)) {
      return PolygonComponent.getLayoutState(geometry);
    }
    console.warn(
      `Geometry.getLayoutState: Unknown geometry ${(geometry as any)?.id} without EllipseComponent / RectangleComponent / PolygonComponent. Returning null.`,
    );
    return null;
  }

  export function setLayoutState(geometry: Geometry, state: LayoutState) {
    switch (state.for) {
      case 'ellipse':
        if (Geometry.hasComponent(geometry, EllipseComponent)) {
          return EllipseComponent.setLayoutState(geometry, state);
        } else {
          return geometry;
        }
      case 'rectangle':
        if (Geometry.hasComponent(geometry, RectangleComponent)) {
          return RectangleComponent.setLayoutState(geometry, state);
        } else {
          return geometry;
        }
      case 'polygon':
        if (Geometry.hasComponent(geometry, PolygonComponent)) {
          return PolygonComponent.setLayoutState(geometry, state);
        } else {
          return geometry;
        }
      default:
        state satisfies never;
        console.warn(
          `Geometry.setLayoutState: Unknown state.for ${(state as any)?.for} / geometry ${(geometry as any)?.id} without EllipseComponent / RectangleComponent / PolygonComponent. Doing nothing.`,
        );
        return geometry;
    }
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
  superHeld: boolean;
  linkDimensions: boolean;
};

/** A type which encodes how a geometry is layed out to the screen, used for generic point
 * manipulations of geometries. */
export type LayoutState = NonNullable<ReturnType<typeof Geometry.getLayoutState>>;
export namespace LayoutState {
  export function translate(
    state: LayoutState,
    transform: (input: SheetPosition) => SheetPosition,
  ) {
    switch (state.for) {
      case 'ellipse':
        return EllipseComponent.layoutStateTranslate(state, transform);
      case 'rectangle':
        return RectangleComponent.layoutStateTranslate(state, transform);
      case 'polygon':
        return PolygonComponent.layoutStateTranslate(state, transform);
      default:
        state satisfies never;
        console.warn(
          `Geometry.transformOrigin: Unknown state.for ${(state as any)?.for}. Doing nothing.`,
        );
        return state;
    }
  }
  export function resizeBBox(
    bbox: Rect<SheetPosition>,
    params: ResizeParams,
  ): Rect<SheetPosition> | null {
    const upperLeft = bbox.position;
    const lowerRight = new SheetPosition(
      bbox.position.x + bbox.width,
      bbox.position.y + bbox.height,
    );

    let newUpperLeft = upperLeft;
    let newLowerRight = lowerRight;

    if (params.mode.type === 'corner') {
      const corner = params.mode.corner;
      const centerX = (upperLeft.x + lowerRight.x) / 2;
      const centerY = (upperLeft.y + lowerRight.y) / 2;

      if (params.altHeld) {
        let dx: number;
        let dy: number;
        switch (corner) {
          case 'top-left':
            dx = centerX - params.to.x;
            dy = centerY - params.to.y;
            break;
          case 'top-right':
            dx = params.to.x - centerX;
            dy = centerY - params.to.y;
            break;
          case 'bottom-left':
            dx = centerX - params.to.x;
            dy = params.to.y - centerY;
            break;
          case 'bottom-right':
            dx = params.to.x - centerX;
            dy = params.to.y - centerY;
            break;
        }
        newUpperLeft = new SheetPosition(centerX - dx, centerY - dy);
        newLowerRight = new SheetPosition(centerX + dx, centerY + dy);
      } else {
        switch (corner) {
          case 'top-left':
            newUpperLeft = params.to;
            break;
          case 'top-right':
            newUpperLeft = new SheetPosition(upperLeft.x, params.to.y);
            newLowerRight = new SheetPosition(params.to.x, lowerRight.y);
            break;
          case 'bottom-left':
            newUpperLeft = new SheetPosition(params.to.x, upperLeft.y);
            newLowerRight = new SheetPosition(lowerRight.x, params.to.y);
            break;
          case 'bottom-right':
            newLowerRight = params.to;
            break;
        }
      }

      if (params.superHeld || params.linkDimensions) {
        const width = newLowerRight.x - newUpperLeft.x;
        const height = newLowerRight.y - newUpperLeft.y;
        const size = Math.max(Math.abs(width), Math.abs(height));
        const signX = width >= 0 ? 1 : -1;
        const signY = height >= 0 ? 1 : -1;
        const newWidth = signX * size;
        const newHeight = signY * size;
        if (params.altHeld) {
          newUpperLeft = new SheetPosition(centerX - newWidth / 2, centerY - newHeight / 2);
          newLowerRight = new SheetPosition(centerX + newWidth / 2, centerY + newHeight / 2);
        } else {
          switch (corner) {
            case 'top-left':
            case 'bottom-left':
              newUpperLeft = new SheetPosition(newLowerRight.x - size, newUpperLeft.y);
              break;
            case 'top-right':
            case 'bottom-right':
              newLowerRight = new SheetPosition(newUpperLeft.x + size, newLowerRight.y);
              break;
          }
          switch (corner) {
            case 'top-left':
            case 'top-right':
              newUpperLeft = new SheetPosition(newUpperLeft.x, newLowerRight.y - size);
              break;
            case 'bottom-left':
            case 'bottom-right':
              newLowerRight = new SheetPosition(newLowerRight.x, newUpperLeft.y + size);
              break;
          }
        }
      }
    } else {
      const edge = params.mode.edge;
      const originalWidth = lowerRight.x - upperLeft.x;
      const originalHeight = lowerRight.y - upperLeft.y;

      if (params.altHeld) {
        const centerX = (upperLeft.x + lowerRight.x) / 2;
        const centerY = (upperLeft.y + lowerRight.y) / 2;
        const halfWidth = originalWidth / 2;
        const halfHeight = originalHeight / 2;

        switch (edge) {
          case 'top':
            newUpperLeft = new SheetPosition(centerX - halfWidth, params.to.y);
            newLowerRight = new SheetPosition(
              centerX + halfWidth,
              centerY + halfHeight + (upperLeft.y - params.to.y),
            );
            if (params.linkDimensions) {
              const newHeight = Math.abs(newLowerRight.y - newUpperLeft.y);
              const newWidth = originalWidth * (newHeight / originalHeight);
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, newUpperLeft.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, newLowerRight.y);
            }
            break;
          case 'bottom':
            newUpperLeft = new SheetPosition(
              centerX - halfWidth,
              centerY - halfHeight - (params.to.y - lowerRight.y),
            );
            newLowerRight = new SheetPosition(centerX + halfWidth, params.to.y);
            if (params.linkDimensions) {
              const newHeight = Math.abs(newLowerRight.y - newUpperLeft.y);
              const newWidth = originalWidth * (newHeight / originalHeight);
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, newUpperLeft.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, newLowerRight.y);
            }
            break;
          case 'left':
            newUpperLeft = new SheetPosition(params.to.x, centerY - halfHeight);
            newLowerRight = new SheetPosition(
              centerX + halfWidth + (upperLeft.x - params.to.x),
              centerY + halfHeight,
            );
            if (params.linkDimensions) {
              const newWidth = Math.abs(newLowerRight.x - newUpperLeft.x);
              const newHeight = originalHeight * (newWidth / originalWidth);
              newUpperLeft = new SheetPosition(newUpperLeft.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(newLowerRight.x, centerY + newHeight / 2);
            }
            break;
          case 'right':
            newUpperLeft = new SheetPosition(
              centerX - halfWidth - (params.to.x - lowerRight.x),
              centerY - halfHeight,
            );
            newLowerRight = new SheetPosition(params.to.x, centerY + halfHeight);
            if (params.linkDimensions) {
              const newWidth = Math.abs(newLowerRight.x - newUpperLeft.x);
              const newHeight = originalHeight * (newWidth / originalWidth);
              newUpperLeft = new SheetPosition(newUpperLeft.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(newLowerRight.x, centerY + newHeight / 2);
            }
            break;
        }
      } else {
        switch (edge) {
          case 'top':
            newUpperLeft = new SheetPosition(upperLeft.x, params.to.y);
            if (params.linkDimensions) {
              const delta = upperLeft.y - params.to.y;
              const newHeight = originalHeight + delta;
              const newWidth = originalWidth * (newHeight / originalHeight);
              const centerX = (upperLeft.x + lowerRight.x) / 2;
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, params.to.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, lowerRight.y);
            }
            break;
          case 'bottom':
            newLowerRight = new SheetPosition(lowerRight.x, params.to.y);
            if (params.linkDimensions) {
              const delta = params.to.y - lowerRight.y;
              const newHeight = originalHeight + delta;
              const newWidth = originalWidth * (newHeight / originalHeight);
              const centerX = (upperLeft.x + lowerRight.x) / 2;
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, upperLeft.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, params.to.y);
            }
            break;
          case 'left':
            newUpperLeft = new SheetPosition(params.to.x, upperLeft.y);
            if (params.linkDimensions) {
              const delta = upperLeft.x - params.to.x;
              const newWidth = originalWidth + delta;
              const newHeight = originalHeight * (newWidth / originalWidth);
              const centerY = (upperLeft.y + lowerRight.y) / 2;
              newUpperLeft = new SheetPosition(params.to.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(lowerRight.x, centerY + newHeight / 2);
            }
            break;
          case 'right':
            newLowerRight = new SheetPosition(params.to.x, lowerRight.y);
            if (params.linkDimensions) {
              const delta = params.to.x - lowerRight.x;
              const newWidth = originalWidth + delta;
              const newHeight = originalHeight * (newWidth / originalWidth);
              const centerY = (upperLeft.y + lowerRight.y) / 2;
              newUpperLeft = new SheetPosition(upperLeft.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(params.to.x, centerY + newHeight / 2);
            }
            break;
        }
      }
    }

    const ul = new SheetPosition(
      Math.min(newUpperLeft.x, newLowerRight.x),
      Math.min(newUpperLeft.y, newLowerRight.y),
    );
    const lr = new SheetPosition(
      Math.max(newUpperLeft.x, newLowerRight.x),
      Math.max(newUpperLeft.y, newLowerRight.y),
    );
    if (ul.x !== lr.x && ul.y !== lr.y) {
      return { position: ul, width: lr.x - ul.x, height: lr.y - ul.y };
    }
    return null;
  }

  export function resize(
    state: LayoutState,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): LayoutState | null {
    switch (state.for) {
      case 'ellipse':
        return EllipseComponent.layoutStateResize(state, params, originalBBox);
      case 'rectangle':
        return RectangleComponent.layoutStateResize(state, params, originalBBox);
      case 'polygon':
        return PolygonComponent.layoutStateResize(state, params, originalBBox);
      default:
        state satisfies never;
        console.warn(
          `LayoutState.resize: Unknown state.for ${(state as any)?.for}. Doing nothing.`,
        );
        return state;
    }
  }

  export function equals(a: LayoutState, b: LayoutState) {
    switch (a.for) {
      case 'ellipse':
        return EllipseComponent.layoutStateEqual(a, b as any);
      case 'rectangle':
        return RectangleComponent.layoutStateEqual(a, b as any);
      case 'polygon':
        return PolygonComponent.layoutStateEqual(a, b as any);
      default:
        a satisfies never;
        console.warn(
          `Geometry.layoutStateEqual: Unknown state.for ${(a as any)?.for}. Returning false.`,
        );
        return false;
    }
  }
}
