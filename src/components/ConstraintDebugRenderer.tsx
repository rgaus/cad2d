import { Graphics } from 'pixi.js';
import { useCallback, useEffect, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useConstraintDebugViewEnabled } from '@/hooks/useConstraintDebugViewEnabled';
import {
  type DistanceEngineConstraint,
  type EngineConstraint,
  type FixedPointEngineConstraint,
  type HorizontalEngineConstraint,
  type ParallelEngingConstraint as ParallelEngineConstraint,
  type PerpendicularEngineConstraint,
  type PointId,
  type VerticalEngingConstraint as VerticalEngineConstraint,
} from '@/lib/constraint-engine';
import { type GeometryStore } from '@/lib/geometry/GeometryStore';
import { SingleLayers } from '@/lib/renderer';
import { UnitType } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

const CONSTRAINT_DEBUG_HELPER_LINE_COLOR = 0x6e56cf;
const CONSTRAINT_DEBUG_BADGE_FILL_COLOR = 0xffffff;
const CONSTRAINT_DEBUG_BADGE_STROKE_COLOR = 0x6e56cf;
const CONSTRAINT_DEBUG_GLYPH_COLOR = 0x4c2889;

const CONSTRAINT_DEBUG_HELPER_LINE_WIDTH_PX = 1;
const CONSTRAINT_DEBUG_BADGE_RADIUS_PX = 7;
const CONSTRAINT_DEBUG_BADGE_STROKE_WIDTH_PX = 1;
const CONSTRAINT_DEBUG_GLYPH_HALF_LENGTH_PX = 3.5;
const CONSTRAINT_DEBUG_GLYPH_LINE_WIDTH_PX = 1.5;
const CONSTRAINT_DEBUG_ARROW_HEAD_LENGTH_PX = 2.5;
const CONSTRAINT_DEBUG_ARROW_HEAD_HALF_HEIGHT_PX = 2;

type ConstraintDebugData = {
  engineConstraints: Array<EngineConstraint>;
  positions: Map<PointId, SheetPosition>;
};

type ConstraintDebugDrawContext = {
  graphics: Graphics;
  positions: Map<PointId, SheetPosition>;
  viewportScale: number;
};

type WorldPoint = {
  x: number;
  y: number;
};

type ResolvedPointPair = {
  pointA: SheetPosition;
  pointB: SheetPosition;
};

function computeConstraintDebugData(
  geometryStore: GeometryStore,
  sheetUnit: UnitType,
): ConstraintDebugData {
  return geometryStore.dcelIndex.computeEngineConstraints(
    geometryStore.constraints,
    [],
    sheetUnit,
  );
}

function drawEngineConstraintDebug(
  constraint: EngineConstraint,
  context: ConstraintDebugDrawContext,
): void {
  switch (constraint.type) {
    case 'distance':
      drawDistanceConstraintDebug(constraint, context);
      return;
    case 'fixedPoint':
      drawFixedPointConstraintDebug(constraint, context);
      return;
    case 'horizontal':
      drawHorizontalConstraintDebug(constraint, context);
      return;
    case 'vertical':
      drawVerticalConstraintDebug(constraint, context);
      return;
    case 'parallel':
      drawParallelConstraintDebug(constraint, context);
      return;
    case 'perpendicular':
      drawPerpendicularConstraintDebug(constraint, context);
      return;
    default:
      throw new Error(`Unhandled constraint debug renderer type: ${JSON.stringify(constraint)}`);
  }
}

function drawDistanceConstraintDebug(
  constraint: DistanceEngineConstraint,
  context: ConstraintDebugDrawContext,
): void {
  const data = resolveTwoPointConstraintDebugDrawData(constraint, context.positions);
  if (!data) {
    return;
  }

  const center = drawPointPairBadge(data, context);
  drawDistanceConstraintGlyph(center, context);
}

function drawFixedPointConstraintDebug(
  constraint: FixedPointEngineConstraint,
  context: ConstraintDebugDrawContext,
): void {
  // TODO: render fixed point constraints.
  void constraint;
  void context;
}

function drawHorizontalConstraintDebug(
  constraint: HorizontalEngineConstraint,
  context: ConstraintDebugDrawContext,
): void {
  const data = resolveTwoPointConstraintDebugDrawData(constraint, context.positions);
  if (!data) {
    return;
  }

  const center = drawPointPairBadge(data, context);
  drawHorizontalConstraintGlyph(center, context);
}

function drawVerticalConstraintDebug(
  constraint: VerticalEngineConstraint,
  context: ConstraintDebugDrawContext,
): void {
  const data = resolveTwoPointConstraintDebugDrawData(constraint, context.positions);
  if (!data) {
    return;
  }

  const center = drawPointPairBadge(data, context);
  drawVerticalConstraintGlyph(center, context);
}

function drawParallelConstraintDebug(
  constraint: ParallelEngineConstraint,
  context: ConstraintDebugDrawContext,
): void {
  // TODO: render parallel constraints.
  void constraint;
  void context;
}

function drawPerpendicularConstraintDebug(
  constraint: PerpendicularEngineConstraint,
  context: ConstraintDebugDrawContext,
): void {
  // TODO: render perpendicular constraints.
  void constraint;
  void context;
}

function resolveTwoPointConstraintDebugDrawData(
  constraint: DistanceEngineConstraint | HorizontalEngineConstraint | VerticalEngineConstraint,
  positions: Map<PointId, SheetPosition>,
): ResolvedPointPair | null {
  const pointA = positions.get(constraint.pointA);
  const pointB = positions.get(constraint.pointB);
  if (!pointA || !pointB) {
    return null;
  }

  return { pointA, pointB };
}

function drawPointPairBadge(
  points: ResolvedPointPair,
  context: ConstraintDebugDrawContext,
): WorldPoint {
  const pointA = points.pointA.toWorld();
  const pointB = points.pointB.toWorld();
  const center = getMidpoint(pointA, pointB);

  drawConstraintDebugHelperLine(pointA, pointB, context);
  drawConstraintDebugBadge(center, context);

  return center;
}

function drawHorizontalConstraintGlyph(
  center: WorldPoint,
  context: ConstraintDebugDrawContext,
): void {
  const glyphHalfLength = CONSTRAINT_DEBUG_GLYPH_HALF_LENGTH_PX / context.viewportScale;
  const glyphLineWidth = CONSTRAINT_DEBUG_GLYPH_LINE_WIDTH_PX / context.viewportScale;

  context.graphics.setStrokeStyle({
    color: CONSTRAINT_DEBUG_GLYPH_COLOR,
    width: glyphLineWidth,
  });

  context.graphics.moveTo(center.x - glyphHalfLength, center.y);
  context.graphics.lineTo(center.x + glyphHalfLength, center.y);
  context.graphics.stroke();
}

function drawVerticalConstraintGlyph(
  center: WorldPoint,
  context: ConstraintDebugDrawContext,
): void {
  const glyphHalfLength = CONSTRAINT_DEBUG_GLYPH_HALF_LENGTH_PX / context.viewportScale;
  const glyphLineWidth = CONSTRAINT_DEBUG_GLYPH_LINE_WIDTH_PX / context.viewportScale;

  context.graphics.setStrokeStyle({
    color: CONSTRAINT_DEBUG_GLYPH_COLOR,
    width: glyphLineWidth,
  });

  context.graphics.moveTo(center.x, center.y - glyphHalfLength);
  context.graphics.lineTo(center.x, center.y + glyphHalfLength);
  context.graphics.stroke();
}

function drawDistanceConstraintGlyph(
  center: WorldPoint,
  context: ConstraintDebugDrawContext,
): void {
  const glyphHalfLength = CONSTRAINT_DEBUG_GLYPH_HALF_LENGTH_PX / context.viewportScale;
  const glyphLineWidth = CONSTRAINT_DEBUG_GLYPH_LINE_WIDTH_PX / context.viewportScale;
  const arrowHeadLength = CONSTRAINT_DEBUG_ARROW_HEAD_LENGTH_PX / context.viewportScale;
  const arrowHeadHalfHeight = CONSTRAINT_DEBUG_ARROW_HEAD_HALF_HEIGHT_PX / context.viewportScale;
  const leftX = center.x - glyphHalfLength;
  const rightX = center.x + glyphHalfLength;

  context.graphics.setStrokeStyle({
    color: CONSTRAINT_DEBUG_GLYPH_COLOR,
    width: glyphLineWidth,
  });

  context.graphics.moveTo(leftX, center.y);
  context.graphics.lineTo(rightX, center.y);

  context.graphics.moveTo(leftX, center.y);
  context.graphics.lineTo(leftX + arrowHeadLength, center.y - arrowHeadHalfHeight);
  context.graphics.moveTo(leftX, center.y);
  context.graphics.lineTo(leftX + arrowHeadLength, center.y + arrowHeadHalfHeight);

  context.graphics.moveTo(rightX, center.y);
  context.graphics.lineTo(rightX - arrowHeadLength, center.y - arrowHeadHalfHeight);
  context.graphics.moveTo(rightX, center.y);
  context.graphics.lineTo(rightX - arrowHeadLength, center.y + arrowHeadHalfHeight);

  context.graphics.stroke();
}

function drawConstraintDebugHelperLine(
  pointA: WorldPoint,
  pointB: WorldPoint,
  context: ConstraintDebugDrawContext,
): void {
  context.graphics.setStrokeStyle({
    color: CONSTRAINT_DEBUG_HELPER_LINE_COLOR,
    width: CONSTRAINT_DEBUG_HELPER_LINE_WIDTH_PX / context.viewportScale,
  });
  context.graphics.moveTo(pointA.x, pointA.y);
  context.graphics.lineTo(pointB.x, pointB.y);
  context.graphics.stroke();
}

function drawConstraintDebugBadge(
  center: WorldPoint,
  context: ConstraintDebugDrawContext,
): void {
  context.graphics.circle(
    center.x,
    center.y,
    CONSTRAINT_DEBUG_BADGE_RADIUS_PX / context.viewportScale,
  );
  context.graphics.setFillStyle({ color: CONSTRAINT_DEBUG_BADGE_FILL_COLOR });
  context.graphics.fill();
  context.graphics.setStrokeStyle({
    color: CONSTRAINT_DEBUG_BADGE_STROKE_COLOR,
    width: CONSTRAINT_DEBUG_BADGE_STROKE_WIDTH_PX / context.viewportScale,
  });
  context.graphics.stroke();
}

function getMidpoint(pointA: WorldPoint, pointB: WorldPoint): WorldPoint {
  return {
    x: (pointA.x + pointB.x) / 2,
    y: (pointA.y + pointB.y) / 2,
  };
}

const ConstraintDebugRendererOverlays: React.FunctionComponent = () => {
  const { geometryStore, sheet, viewportScale } = useViewportContext();
  const [debugData, setDebugData] = useState<ConstraintDebugData>(() =>
    computeConstraintDebugData(geometryStore, sheet.defaultUnit),
  );
  const enabled = useConstraintDebugViewEnabled();

  useEffect(() => {
    let disposed = false;
    let updateQueued = false;

    const updateDebugData = () => {
      if (disposed) {
        return;
      }
      setDebugData(computeConstraintDebugData(geometryStore, sheet.defaultUnit));
    };

    const scheduleDebugDataUpdate = () => {
      if (updateQueued) {
        return;
      }
      updateQueued = true;
      queueMicrotask(() => {
        updateQueued = false;
        updateDebugData();
      });
    };

    geometryStore.on('polygonsChanged', scheduleDebugDataUpdate);
    geometryStore.on('rectanglesChanged', scheduleDebugDataUpdate);
    geometryStore.on('ellipsesChanged', scheduleDebugDataUpdate);
    geometryStore.on('constraintsChanged', scheduleDebugDataUpdate);
    geometryStore.dcelIndex.dcel.on('handleHalfEdgesChange', scheduleDebugDataUpdate);
    sheet.on('defaultUnitChange', scheduleDebugDataUpdate);
    updateDebugData();

    return () => {
      disposed = true;
      geometryStore.off('polygonsChanged', scheduleDebugDataUpdate);
      geometryStore.off('rectanglesChanged', scheduleDebugDataUpdate);
      geometryStore.off('ellipsesChanged', scheduleDebugDataUpdate);
      geometryStore.off('constraintsChanged', scheduleDebugDataUpdate);
      geometryStore.dcelIndex.dcel.off('handleHalfEdgesChange', scheduleDebugDataUpdate);
      sheet.off('defaultUnitChange', scheduleDebugDataUpdate);
    };
  }, [geometryStore, sheet]);

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      const context: ConstraintDebugDrawContext = {
        graphics,
        positions: debugData.positions,
        viewportScale,
      };
      for (const constraint of debugData.engineConstraints) {
        drawEngineConstraintDebug(constraint, context);
      }
    },
    [debugData, viewportScale],
  );

  if (!enabled) {
    return null;
  }

  return (
    <pixiContainer>
      <pixiGraphics draw={draw} />
    </pixiContainer>
  );
};

export const ConstraintDebugRenderer: SingleLayers<React.ReactNode> = {
  Overlays: <ConstraintDebugRendererOverlays />,
};
