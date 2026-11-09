import { type Matrix, applyToPoint, compose, identity } from 'transformation-matrix';
import { RenderShape } from '@/lib/entity/render-shape';
import { OrientedBoundingBox } from '@/lib/math';
import { type FieldOptionsList } from '@/lib/selection/fields';
import { type SelectionInspectorContext } from '@/lib/selection/selection-inspector-context';
import { UnitType } from '@/lib/units/length';
import {
  GeometryRelativeSheetPosition,
  KeyPoints,
  OrientedRect,
  Position,
  Rect,
  SheetPosition,
  mapKeyPoints,
} from '@/lib/viewport/types';
import { AnchorPointComponent } from './components/AnchorPointComponent';
import { ConstraintComponent } from './components/ConstraintComponent';
import { DatumComponent } from './components/DatumComponent';
import { FillColorComponent } from './components/FillColorComponent';
import { FilterComponent } from './components/FilterComponent';
import { FrameComponent } from './components/FrameComponent';
import { GeometryComponent } from './components/GeometryComponent';
import { InvoluteGearComponent } from './components/InvoluteGearComponent';
import { LinkDimensionsComponent } from './components/LinkDimensionsComponent';
import { RenderOrderComponent } from './components/RenderOrderComponent';
import { RotationComponent } from './components/RotationComponent';
import { TransformableTemplate } from './components/templates/TransformableTemplate';

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

  /** Key points in geometry-relative coordinates for a geometry entity. Datums and frames have no
   * geometry-relative frame; use {@link keyPointsInSheet} to include them. */
  export function keyPoints(
    entity: Entity<GeometryComponent>,
  ): KeyPoints<GeometryRelativeSheetPosition, string, string> {
    return GeometryComponent.keyPoints(entity);
  }

  function relativeToSheet(
    position: GeometryRelativeSheetPosition,
    entity: Entity,
    origin: SheetPosition,
  ): SheetPosition {
    const transformed = applyToPoint(
      Entity.generateRenderMatrix(entity),
      new SheetPosition(origin.x + position.x, origin.y + position.y),
    );
    return new SheetPosition(transformed.x, transformed.y);
  }

  /** Key points projected into absolute rendered sheet space. Geometry key points are projected
   * through their render transform; datum and frame key points are already absolute. */
  export function keyPointsInSheet(entity: Entity): KeyPoints<SheetPosition, string, string> {
    const adapter = TransformableTemplate.getForEntity(entity);
    if (adapter) {
      return mapKeyPoints(adapter.keyPoints(entity), (position) =>
        relativeToSheet(position, entity, adapter.getOrigin(entity)),
      );
    }
    if (Entity.hasComponent(entity, GeometryComponent)) {
      return mapKeyPoints(GeometryComponent.keyPoints(entity), (position) =>
        position.toSheet(entity),
      );
    } else if (Entity.hasComponent(entity, DatumComponent)) {
      return DatumComponent.keyPoints(entity);
    } else if (Entity.hasComponent(entity, FrameComponent)) {
      return FrameComponent.keyPoints(entity);
    }
    throw new Error(`Entity.keyPointsInSheet: unknown geometry type for id=${entity.id}`);
  }

  export function orientedBoundingBox(entity: Entity): OrientedRect<Position> {
    const adapter = TransformableTemplate.getForEntity(entity);
    if (adapter) {
      return adapter.orientedBoundingBox(entity);
    }
    if (Entity.hasComponent(entity, GeometryComponent)) {
      return GeometryComponent.orientedBoundingBox(entity);
    } else if (Entity.hasComponent(entity, DatumComponent)) {
      return DatumComponent.orientedBoundingBox(entity);
    } else if (Entity.hasComponent(entity, FrameComponent)) {
      return FrameComponent.orientedBoundingBox(entity);
    }
    throw new Error(`Entity.orientedBoundingBox: unknown geometry type for id=${entity.id}`);
  }

  export function boundingBox(entity: Entity): Rect<Position> {
    const adapter = TransformableTemplate.getForEntity(entity);
    if (adapter) {
      return adapter.boundingBox(entity);
    }
    if (Entity.hasComponent(entity, GeometryComponent)) {
      return GeometryComponent.boundingBox(entity);
    } else if (Entity.hasComponent(entity, DatumComponent)) {
      return DatumComponent.boundingBox(entity);
    } else if (Entity.hasComponent(entity, FrameComponent)) {
      return FrameComponent.boundingBox(entity);
    }
    throw new Error(`Entity.boundingBox: unknown geometry type for id=${entity.id}`);
  }

  /** Returns the entity's oriented bounding box projected into rendered sheet space. Datum and
   * frame positions are already absolute sheet positions. */
  export function orientedBoundingBoxInSheet(entity: Entity): OrientedRect<SheetPosition> {
    const adapter = TransformableTemplate.getForEntity(entity);
    if (adapter) {
      const rect = adapter.orientedBoundingBox(entity);
      return OrientedBoundingBox.mapPositions(rect, (position) =>
        relativeToSheet(position, entity, adapter.getOrigin(entity)),
      );
    }
    if (Entity.hasComponent(entity, GeometryComponent)) {
      const rect = GeometryComponent.orientedBoundingBox(entity);
      return OrientedBoundingBox.mapPositions(rect, (position) => position.toSheet(entity));
    }
    return orientedBoundingBox(entity) as OrientedRect<SheetPosition>;
  }

  /** Returns the entity's axis-aligned bounding box projected into rendered sheet space. */
  export function boundingBoxInSheet(entity: Entity): Rect<SheetPosition> {
    if (Entity.hasComponent(entity, GeometryComponent)) {
      return OrientedBoundingBox.toRect(orientedBoundingBoxInSheet(entity));
    }
    return boundingBox(entity) as Rect<SheetPosition>;
  }

  /** Given an {@link Entity}, compute the transform function to take the entity and project it into
   * where it should be rendered, based on any transformations like anchor point, rotation, etc. */
  export function generateRenderTransformFunction(entity: Entity) {
    if (Entity.hasComponent(entity, AnchorPointComponent)) {
      const anchor = AnchorPointComponent.generateRenderTransformFunction(entity);
      if (Entity.hasComponent(entity, RotationComponent)) {
        const rotate = RotationComponent.generateRenderTransformFunction(entity);
        return (position: SheetPosition) => rotate(anchor(position));
      }
      return anchor;
    }

    if (Entity.hasComponent(entity, RotationComponent)) {
      return RotationComponent.generateRenderTransformFunction(entity);
    }

    return (position: SheetPosition) => position;
  }

  /** Given an {@link Entity}, compute the matrix to take the entity and project it into where it
   * should be rendered, based on any transformations like anchor point, rotation, etc. */
  export function generateRenderMatrix(entity: Entity): Matrix {
    if (Entity.hasComponent(entity, AnchorPointComponent)) {
      const anchor = AnchorPointComponent.generateRenderMatrix(entity);
      if (Entity.hasComponent(entity, RotationComponent)) {
        const rotate = RotationComponent.generateRenderMatrix(entity);
        return compose(rotate, anchor);
      }
      return anchor;
    }

    if (Entity.hasComponent(entity, RotationComponent)) {
      return RotationComponent.generateRenderMatrix(entity);
    }

    return identity();
  }

  export function getRenderShapes(entity: Entity, sheetDefaultUnit: UnitType): Array<RenderShape> {
    const adapter = TransformableTemplate.getForEntity(entity);
    if (adapter) {
      return adapter.getRenderShapes(entity, sheetDefaultUnit);
    }
    if (Entity.hasComponent(entity, GeometryComponent)) {
      return GeometryComponent.getRenderShapes(entity, sheetDefaultUnit);
    } else if (Entity.hasComponent(entity, DatumComponent)) {
      return DatumComponent.getRenderShapes(entity, sheetDefaultUnit);
    } else if (Entity.hasComponent(entity, FrameComponent)) {
      return FrameComponent.getRenderShapes(entity, sheetDefaultUnit);
    }

    return [];
  }

  /** The order of components in the selection inspector. If a component isn't in this list, it
   * will be rendered at the bottom. */
  function getComponentKeyOrdering(key: string): number {
    return [
      InvoluteGearComponent.key,
      GeometryComponent.key,
      ConstraintComponent.key,
      DatumComponent.key,
      FilterComponent.key,
      FrameComponent.key,
      LinkDimensionsComponent.key,

      // Fill color + render order at the bottom
      FillColorComponent.key,
      RenderOrderComponent.key,
      RotationComponent.key,
      AnchorPointComponent.key,
    ].indexOf(key as any);
  }

  export function getComponentByKey(key: string) {
    for (const component of [
      InvoluteGearComponent,
      GeometryComponent,
      FillColorComponent,
      ConstraintComponent,
      DatumComponent,
      FilterComponent,
      FrameComponent,
      LinkDimensionsComponent,
      RenderOrderComponent,
      AnchorPointComponent,
      RotationComponent,
    ]) {
      if (component.key === key) {
        return component;
      }
    }
    return null;
  }

  /** Dispatches a single entity + component to that component's field builder. Each component owns
   * the knowledge of which fields it contributes; this method only routes and guards. */
  function computeFieldsForComponent(
    entity: Entity,
    Component: NonNullable<ReturnType<typeof getComponentByKey>>,
    context: SelectionInspectorContext,
  ): FieldOptionsList {
    switch (Component.key) {
      case InvoluteGearComponent.key: {
        if (!Entity.hasComponent(entity, InvoluteGearComponent)) {
          return [];
        }
        return InvoluteGearComponent.computeSelectionInspectorFields(entity, context);
      }
      case GeometryComponent.key: {
        if (!Entity.hasComponent(entity, GeometryComponent)) {
          return [];
        }
        return GeometryComponent.computeSelectionInspectorFields(entity, context);
      }
      case FillColorComponent.key: {
        if (!Entity.hasComponent(entity, FillColorComponent)) {
          return [];
        }
        return FillColorComponent.computeSelectionInspectorFields(entity, context);
      }
      case RenderOrderComponent.key: {
        if (!Entity.hasComponent(entity, RenderOrderComponent)) {
          return [];
        }
        return RenderOrderComponent.computeSelectionInspectorFields(entity, context);
      }
      case FrameComponent.key: {
        if (!Entity.hasComponent(entity, FrameComponent)) {
          return [];
        }
        return FrameComponent.computeSelectionInspectorFields(entity, context);
      }
      case DatumComponent.key: {
        if (!Entity.hasComponent(entity, DatumComponent)) {
          return [];
        }
        return DatumComponent.computeSelectionInspectorFields(entity, context);
      }
      case FilterComponent.key: {
        if (!Entity.hasComponent(entity, FilterComponent)) {
          return [];
        }
        return FilterComponent.computeSelectionInspectorFields(entity, context);
      }
      case ConstraintComponent.key: {
        if (!Entity.hasComponent(entity, ConstraintComponent)) {
          return [];
        }
        return ConstraintComponent.computeSelectionInspectorFields(entity, context);
      }
      case LinkDimensionsComponent.key: {
        // LinkDimensionsComponent is consumed within GeometryComponent to conditionally show the
        // link button. It does not render its own standalone fields.
        return [];
      }
      case AnchorPointComponent.key: {
        if (!Entity.hasComponent(entity, AnchorPointComponent)) {
          return [];
        }
        return AnchorPointComponent.computeSelectionInspectorFields(entity, context);
      }
      case RotationComponent.key: {
        if (!Entity.hasComponent(entity, RotationComponent)) {
          return [];
        }
        return RotationComponent.computeSelectionInspectorFields(entity, context);
      }
      default:
        Component satisfies never;
        return [];
    }
  }

  /** Builds the ordered list of selection-inspector fields contributed by a single entity's
   * components. */
  export function computeSelectionInspectorFields(
    entity: Entity,
    context: SelectionInspectorContext,
  ): FieldOptionsList {
    const componentKeys = Object.keys(entity.components).sort((a, b) => {
      return getComponentKeyOrdering(a) - getComponentKeyOrdering(b);
    });

    return componentKeys.flatMap((key) => {
      const Component = getComponentByKey(key);
      if (!Component) {
        return [];
      }
      return computeFieldsForComponent(entity, Component, context);
    });
  }
}

export type EntityOmitComponents<G extends Entity, C> = Omit<G, 'components'> & {
  components: Omit<G['components'], keyof C>;
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

/**
 * Describes the local (unrotated) frame that resize coordinates are expressed in. This lets callers
 * pass oriented handle coordinates instead of pre-rotating every point into a world AABB.
 */
export type ResizeFrame = {
  /** Rotation of the geometry's local frame relative to sheet space, in degrees. */
  angleDegrees: number;
  /** Numeric pivot about which the local frame is rotated. Defaults to the geometry's raw natural
   * origin, matching {@link RotationComponent}. */
  pivot?: SheetPosition;
};

/** Parameters for performing a per-geometry resize via LayoutState.resize. */
export type ResizeParams = {
  to: SheetPosition;
  mode: ResizeMode;
  altHeld: boolean;
  shiftHeld: boolean;
  linkDimensions: boolean;
  /** Optional oriented frame for rotation-aware resize. Defaults to an unrotated frame. */
  frame?: ResizeFrame;
};
