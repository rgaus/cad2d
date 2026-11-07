import { Entity, GeometryComponent, type Id, type ResizeFrame } from '@/lib/entity';
import { BoundingBox, OrientedBoundingBox, rotatePointAround } from '@/lib/math';
import { type OrientedRect, type Rect, SheetPosition } from '@/lib/viewport/types';

const ANGLE_EPSILON = 1e-6;

/** The axis-aligned outline is only useful when it extends beyond the oriented selection box,
 * which happens when filters produce extra render shapes. */
export function shouldShowSelectionOutline(
  selectionBbox: OrientedRect<SheetPosition> | null,
  selectionOutline: Rect<SheetPosition> | null,
): boolean {
  if (!selectionBbox || !selectionOutline) {
    return false;
  }
  return !BoundingBox.equals(OrientedBoundingBox.toRect(selectionBbox), selectionOutline);
}

/** The frame (rotation + pivot) and oriented bounds used to resize one or more entities. */
export type SelectionResizeTarget = {
  /** Oriented bounding box in rendered sheet space. */
  bbox: OrientedRect<SheetPosition>;
  /** Frame that resize coordinates should be interpreted in. */
  frame: ResizeFrame;
};

/**
 * The shared resize frame for a selection.
 *
 * Strategy:
 * - A single entity is resized in its own oriented frame.
 * - Multiple entities with matching rotation angles share one oriented group frame. Individual
 *   geometries still use their own pivot so anchor offsets stay correct, but the group's oriented
 *   bounding box is used as the resize box so unrotated multi-selection keeps its percentage-based
 *   behavior.
 * - Mixed rotation angles fall back to the legacy world-axis union bounding box. A union of
 *   differently-oriented rectangles cannot remain oriented, so this is an explicit fallback rather
 *   than a per-geometry frame.
 */
export type SelectionResizeFrame = SelectionResizeTarget & {
  strategy: 'single' | 'same-angle' | 'axis-aligned-fallback';
  /** Per-entity frame used when dispatching resize math. */
  perEntity: Map<Id, ResizeFrame>;
};

function anglesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < ANGLE_EPSILON;
}

function frameForEntity(entity: Entity, angleDegrees: number): ResizeFrame {
  if (!Entity.hasComponent(entity, GeometryComponent)) {
    return { angleDegrees };
  }
  return {
    angleDegrees,
    pivot: GeometryComponent.getResizeFrame(entity).pivot,
  };
}

/** Returns the oriented bounding box in rendered sheet space. */
function renderedBoundingBox(entity: Entity): OrientedRect<SheetPosition> {
  return Entity.orientedBoundingBoxInSheet(entity);
}

/**
 * Computes the oriented union of same-angle oriented rectangles. The pivot is arbitrary; it only
 * controls the local coordinate frame used while unioning the corners.
 */
function unionSameAngleBoundingBoxes(
  bboxes: Array<OrientedRect<SheetPosition>>,
  angleDegrees: number,
): OrientedRect<SheetPosition> {
  const pivot = bboxes[0].position;
  const localCorners = bboxes.flatMap((bbox) =>
    OrientedBoundingBox.cornersToArray(bbox).map((corner) =>
      rotatePointAround(corner, pivot, -angleDegrees),
    ),
  );
  const localBox = BoundingBox.fromPoints(localCorners);
  return {
    position: rotatePointAround(localBox.position, pivot, angleDegrees),
    width: localBox.width,
    height: localBox.height,
    angleDegrees,
  };
}

/** Computes the shared resize frame for the given selection, or null when there is no renderable
 * entity with a bounding box. */
export function computeSelectionResizeFrame(entities: Array<Entity>): SelectionResizeFrame | null {
  const withBBoxes = entities.flatMap((entity) => {
    try {
      return [{ entity, bbox: renderedBoundingBox(entity) }];
    } catch {
      return [];
    }
  });
  if (withBBoxes.length === 0) {
    return null;
  }

  if (withBBoxes.length === 1) {
    const { entity, bbox } = withBBoxes[0];
    const frame = frameForEntity(entity, bbox.angleDegrees);
    return {
      bbox,
      frame,
      strategy: 'single',
      perEntity: new Map([[entity.id, frame]]),
    };
  }

  const angleDegrees = withBBoxes[0].bbox.angleDegrees;
  const sameAngle = withBBoxes.every(({ bbox }) => anglesEqual(bbox.angleDegrees, angleDegrees));
  if (sameAngle) {
    return {
      bbox: unionSameAngleBoundingBoxes(
        withBBoxes.map(({ bbox }) => bbox),
        angleDegrees,
      ),
      frame: { angleDegrees },
      strategy: 'same-angle',
      perEntity: new Map(
        withBBoxes.map(({ entity }) => [entity.id, frameForEntity(entity, angleDegrees)]),
      ),
    };
  }

  const union = BoundingBox.union(withBBoxes.map(({ bbox }) => OrientedBoundingBox.toRect(bbox)))!;
  return {
    bbox: OrientedBoundingBox.fromRect(union),
    frame: { angleDegrees: 0 },
    strategy: 'axis-aligned-fallback',
    perEntity: new Map(withBBoxes.map(({ entity }) => [entity.id, { angleDegrees: 0 }])),
  };
}

/**
 * Returns the screen-space offset between an outset resize handle and the underlying (non-outset)
 * handle. The offset is applied along the resize frame's local axes, not world axes.
 */
export function computeResizePointerOutset(
  mode: { type: 'corner'; corner: string } | { type: 'edge'; edge: string },
  angleDegrees: number,
  outsetPx: number,
): SheetPosition {
  let localX = 0;
  let localY = 0;
  if (mode.type === 'corner') {
    switch (mode.corner) {
      case 'top-left':
        localX = outsetPx;
        localY = outsetPx;
        break;
      case 'top-right':
        localX = -outsetPx;
        localY = outsetPx;
        break;
      case 'bottom-left':
        localX = outsetPx;
        localY = -outsetPx;
        break;
      case 'bottom-right':
        localX = -outsetPx;
        localY = -outsetPx;
        break;
    }
  } else {
    switch (mode.edge) {
      case 'top':
        localY = outsetPx;
        break;
      case 'bottom':
        localY = -outsetPx;
        break;
      case 'left':
        localX = outsetPx;
        break;
      case 'right':
        localX = -outsetPx;
        break;
    }
  }

  return rotatePointAround(
    new SheetPosition(localX, localY),
    new SheetPosition(0, 0),
    angleDegrees,
  );
}
