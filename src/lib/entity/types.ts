import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { DatumComponent } from './components/DatumComponent';
import { GeometryComponent } from './components/GeometryComponent';
import { type GeometryData } from './geometry';
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

  export function keyPoints(
    geometry: Entity<GeometryComponent>,
  ): ReturnType<typeof GeometryComponent.keyPoints>;
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

  export function boundingBox(geometry: Entity<GeometryComponent>): Rect<SheetPosition>;
  export function boundingBox(geometry: Entity<DatumComponent>): Rect<SheetPosition>;
  export function boundingBox(geometry: Entity): Rect<SheetPosition> {
    if (Entity.hasComponent(geometry, GeometryComponent)) {
      return GeometryComponent.boundingBox(geometry as Entity<GeometryComponent>);
    } else if (Entity.hasComponent(geometry, DatumComponent)) {
      return DatumComponent.boundingBox(geometry);
    }
    throw new Error(`Geometry.boundingBox: unknown geometry type for id=${geometry.id}`);
  }

  export function getLayoutState(geometry: Entity) {
    if (Entity.hasComponent(geometry, GeometryComponent)) {
      const data = GeometryComponent.get(geometry) as GeometryData;
      switch (data.type) {
        case 'ellipse':
          return {
            for: 'ellipse' as const,
            center: data.center,
            radiusX: data.radiusX,
            radiusY: data.radiusY,
          };
        case 'rectangle':
          return {
            for: 'rectangle' as const,
            upperLeft: data.upperLeft,
            lowerRight: data.lowerRight,
          };
        case 'polygon':
          return { for: 'polygon' as const, points: data.points };
        default:
          data satisfies never;
          return null;
      }
    } else if (Entity.hasComponent(geometry, DatumComponent)) {
      return DatumComponent.getLayoutState(geometry);
    }
    return null;
  }

  export function setLayoutState(geometry: Entity, state: LayoutState) {
    switch (state.for) {
      case 'ellipse':
        if (Entity.hasComponent(geometry, GeometryComponent)) {
          return GeometryComponent.update(geometry as Entity<GeometryComponent<EllipseData>>, {
            center: state.center,
            radiusX: state.radiusX,
            radiusY: state.radiusY,
          });
        }
        return geometry;
      case 'rectangle':
        if (Entity.hasComponent(geometry, GeometryComponent)) {
          return GeometryComponent.update(geometry as Entity<GeometryComponent<RectangleData>>, {
            upperLeft: state.upperLeft,
            lowerRight: state.lowerRight,
          });
        }
        return geometry;
      case 'polygon':
        if (Entity.hasComponent(geometry, GeometryComponent)) {
          return GeometryComponent.update(geometry as Entity<GeometryComponent<PolygonData>>, {
            points: state.points,
          });
        }
        return geometry;
      case 'datum':
        if (Entity.hasComponent(geometry, DatumComponent)) {
          return DatumComponent.setLayoutState(geometry, state);
        }
        return geometry;
      default:
        state satisfies never;
        return geometry;
    }
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

/** A type which encodes how a geometry is layed out to the screen, used for generic point
 * manipulations of geometries. */
export type LayoutState = NonNullable<ReturnType<typeof Entity.getLayoutState>>;
export namespace LayoutState {
  export function translate(
    state: LayoutState,
    transform: (input: SheetPosition) => SheetPosition,
  ) {
    switch (state.for) {
      case 'ellipse':
        return { ...state, center: transform(state.center) } as LayoutState;
      case 'rectangle':
        return {
          ...state,
          upperLeft: transform(state.upperLeft),
          lowerRight: new SheetPosition(
            transform(state.upperLeft).x + (state.lowerRight.x - state.upperLeft.x),
            transform(state.upperLeft).y + (state.lowerRight.y - state.upperLeft.y),
          ),
        } as LayoutState;
      case 'polygon':
        return {
          ...state,
          points: state.points.map((seg) => {
            const newSeg = { ...seg, point: transform(seg.point) } as typeof seg;
            if (newSeg.type === 'arc-quadratic') {
              return { ...newSeg, controlPoint: transform((seg as any).controlPoint) };
            }
            if (newSeg.type === 'arc-cubic') {
              return {
                ...newSeg,
                controlPointA: transform((seg as any).controlPointA),
                controlPointB: transform((seg as any).controlPointB),
              };
            }
            return newSeg;
          }),
        } as LayoutState;
      case 'datum':
        return { ...state, position: transform(state.position) } as LayoutState;
      default:
        state satisfies never;
        console.warn(
          `LayoutState.translate: Unknown state.for ${(state as any)?.for}. Doing nothing.`,
        );
        return state;
    }
  }

  /** Returns the origin point of a layout state, corresponding to what the selection inspector
   *  shows as the shape's x/y position. For rectangle this is upperLeft, for ellipse it is center,
   *  for polygon it is the bounding box upper-left corner. */
  export function getOrigin(state: LayoutState): SheetPosition {
    switch (state.for) {
      case 'ellipse':
        return state.center;
      case 'rectangle':
        return state.upperLeft;
      case 'polygon': {
        const xs = state.points.map((p) => p.point.x);
        const ys = state.points.map((p) => p.point.y);
        return new SheetPosition(Math.min(...xs), Math.min(...ys));
      }
      case 'datum':
        return state.position;
      default:
        state satisfies never;
        throw new Error(`LayoutState.getOrigin: Unknown state.for ${(state as any)?.for}`);
    }
  }

  /** Returns the bounding box of a layout state. */
  export function getBoundingBox(state: LayoutState): Rect<SheetPosition> {
    switch (state.for) {
      case 'ellipse':
        return {
          position: new SheetPosition(
            state.center.x - state.radiusX,
            state.center.y - state.radiusY,
          ),
          width: state.radiusX * 2,
          height: state.radiusY * 2,
        };
      case 'rectangle':
        return {
          position: state.upperLeft,
          width: state.lowerRight.x - state.upperLeft.x,
          height: state.lowerRight.y - state.upperLeft.y,
        };
      case 'polygon': {
        const xs = state.points.map((p) => p.point.x);
        const ys = state.points.map((p) => p.point.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        return {
          position: new SheetPosition(minX, minY),
          width: maxX - minX,
          height: maxY - minY,
        };
      }
      case 'datum':
        return {
          position: state.position,
          width: 0,
          height: 0,
        };
      default:
        state satisfies never;
        throw new Error(`LayoutState.getBoundingBox: Unknown state.for ${(state as any)?.for}`);
    }
  }

  export function resize(
    state: LayoutState,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): LayoutState | null {
    if (!originalBBox) {
      originalBBox = LayoutState.getBoundingBox(state);
    }
    const newBBox = GeometryComponent.resizeBBox(originalBBox, params);
    if (!newBBox) {
      return null;
    }
    switch (state.for) {
      case 'ellipse':
        return {
          ...state,
          center: new SheetPosition(
            newBBox.position.x + newBBox.width / 2,
            newBBox.position.y + newBBox.height / 2,
          ),
          radiusX: newBBox.width / 2,
          radiusY: newBBox.height / 2,
        } as LayoutState;
      case 'rectangle':
        return {
          ...state,
          upperLeft: newBBox.position,
          lowerRight: new SheetPosition(
            newBBox.position.x + newBBox.width,
            newBBox.position.y + newBBox.height,
          ),
        } as LayoutState;
      case 'polygon': {
        const factorX = newBBox.width / originalBBox.width;
        const factorY = newBBox.height / originalBBox.height;
        return {
          ...state,
          points: state.points.map((p) => ({
            ...p,
            point: new SheetPosition(
              newBBox.position.x + (p.point.x - originalBBox.position.x) * factorX,
              newBBox.position.y + (p.point.y - originalBBox.position.y) * factorY,
            ),
          })),
        } as LayoutState;
      }
      case 'datum':
        return null;
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
        return (
          b.for === 'ellipse' &&
          a.center.x === b.center.x &&
          a.center.y === b.center.y &&
          a.radiusX === b.radiusX &&
          a.radiusY === b.radiusY
        );
      case 'rectangle':
        return (
          b.for === 'rectangle' &&
          a.upperLeft.x === b.upperLeft.x &&
          a.upperLeft.y === b.upperLeft.y &&
          a.lowerRight.x === b.lowerRight.x &&
          a.lowerRight.y === b.lowerRight.y
        );
      case 'polygon':
        if (b.for !== 'polygon' || a.points.length !== b.points.length) {
          return false;
        }
        return a.points.every(
          (p, i) => p.point.x === b.points[i].point.x && p.point.y === b.points[i].point.y,
        );
      case 'datum':
        return b.for === 'datum' && a.position.x === b.position.x && a.position.y === b.position.y;
      default:
        a satisfies never;
        console.warn(`LayoutState.equals: Unknown state.for ${(a as any)?.for}. Returning false.`);
        return false;
    }
  }
}
