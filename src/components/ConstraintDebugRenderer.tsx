import { Graphics } from 'pixi.js';
import { useCallback, useEffect, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useConstraintDebugViewEnabled } from '@/hooks/useConstraintDebugViewEnabled';
import {
  type DistanceEngineConstraint,
  type EngineConstraint,
  type FixedPointEngineConstraint,
  type HorizontalEngineConstraint,
  type ParallelEngingConstraint,
  type PerpendicularEngineConstraint,
  type PointId,
  type VerticalEngingConstraint,
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

type TwoPointConstraintDebugDrawData<ConstraintType extends EngineConstraint> = {
  constraint: ConstraintType;
  pointA: SheetPosition;
  pointB: SheetPosition;
};

type FixedPointConstraintDebugDrawData = {
  constraint: FixedPointEngineConstraint;
  point: SheetPosition;
  targetPosition: SheetPosition;
};

type TwoSegmentConstraintDebugDrawData<ConstraintType extends EngineConstraint> = {
  constraint: ConstraintType;
  segmentA: {
    pointA: SheetPosition;
    pointB: SheetPosition;
  };
  segmentB: {
    pointA: SheetPosition;
    pointB: SheetPosition;
  };
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

  drawDistanceConstraintGlyph(data, context);
}

function drawFixedPointConstraintDebug(
  constraint: FixedPointEngineConstraint,
  context: ConstraintDebugDrawContext,
): void {
  const data = resolveFixedPointConstraintDebugDrawData(constraint, context.positions);
  if (!data) {
    return;
  }

  scaffoldConstraintDebugDraw(context, data);
}

function drawHorizontalConstraintDebug(
  constraint: HorizontalEngineConstraint,
  context: ConstraintDebugDrawContext,
): void {
  const data = resolveTwoPointConstraintDebugDrawData(constraint, context.positions);
  if (!data) {
    return;
  }

  drawAxisConstraintDebug(data, context, 'horizontal');
}

function drawVerticalConstraintDebug(
  constraint: VerticalEngingConstraint,
  context: ConstraintDebugDrawContext,
): void {
  const data = resolveTwoPointConstraintDebugDrawData(constraint, context.positions);
  if (!data) {
    return;
  }

  drawAxisConstraintDebug(data, context, 'vertical');
}

function drawParallelConstraintDebug(
  constraint: ParallelEngingConstraint,
  context: ConstraintDebugDrawContext,
): void {
  const data = resolveTwoSegmentConstraintDebugDrawData(constraint, context.positions);
  if (!data) {
    return;
  }

  scaffoldConstraintDebugDraw(context, data);
}

function drawPerpendicularConstraintDebug(
  constraint: PerpendicularEngineConstraint,
  context: ConstraintDebugDrawContext,
): void {
  const data = resolveTwoSegmentConstraintDebugDrawData(constraint, context.positions);
  if (!data) {
    return;
  }

  scaffoldConstraintDebugDraw(context, data);
}

function resolveTwoPointConstraintDebugDrawData<
  ConstraintType extends DistanceEngineConstraint | HorizontalEngineConstraint | VerticalEngingConstraint,
>(
  constraint: ConstraintType,
  positions: Map<PointId, SheetPosition>,
): TwoPointConstraintDebugDrawData<ConstraintType> | null {
  const pointA = positions.get(constraint.pointA);
  const pointB = positions.get(constraint.pointB);
  if (!pointA || !pointB) {
    return null;
  }

  return { constraint, pointA, pointB };
}

function resolveFixedPointConstraintDebugDrawData(
  constraint: FixedPointEngineConstraint,
  positions: Map<PointId, SheetPosition>,
): FixedPointConstraintDebugDrawData | null {
  const point = positions.get(constraint.point);
  if (!point) {
    return null;
  }

  return { constraint, point, targetPosition: constraint.position };
}

function resolveTwoSegmentConstraintDebugDrawData<
  ConstraintType extends ParallelEngingConstraint | PerpendicularEngineConstraint,
>(
  constraint: ConstraintType,
  positions: Map<PointId, SheetPosition>,
): TwoSegmentConstraintDebugDrawData<ConstraintType> | null {
  const segmentAPointA = positions.get(constraint.segmentA.pointA);
  const segmentAPointB = positions.get(constraint.segmentA.pointB);
  const segmentBPointA = positions.get(constraint.segmentB.pointA);
  const segmentBPointB = positions.get(constraint.segmentB.pointB);
  if (!segmentAPointA || !segmentAPointB || !segmentBPointA || !segmentBPointB) {
    return null;
  }

  return {
    constraint,
    segmentA: {
      pointA: segmentAPointA,
      pointB: segmentAPointB,
    },
    segmentB: {
      pointA: segmentBPointA,
      pointB: segmentBPointB,
    },
  };
}

function scaffoldConstraintDebugDraw(
  context: ConstraintDebugDrawContext,
  data:
    | TwoPointConstraintDebugDrawData<DistanceEngineConstraint>
    | TwoPointConstraintDebugDrawData<HorizontalEngineConstraint>
    | TwoPointConstraintDebugDrawData<VerticalEngingConstraint>
    | FixedPointConstraintDebugDrawData
    | TwoSegmentConstraintDebugDrawData<ParallelEngingConstraint>
    | TwoSegmentConstraintDebugDrawData<PerpendicularEngineConstraint>,
): void {
  // TODO: render each engine constraint type.
  void context.graphics;
  void context.viewportScale;
  void data;
}

function drawAxisConstraintDebug(
  data:
    | TwoPointConstraintDebugDrawData<HorizontalEngineConstraint>
    | TwoPointConstraintDebugDrawData<VerticalEngingConstraint>,
  context: ConstraintDebugDrawContext,
  axis: 'horizontal' | 'vertical',
): void {
  const pointA = data.pointA.toWorld();
  const pointB = data.pointB.toWorld();
  const center = getMidpoint(pointA, pointB);
  const glyphHalfLength = CONSTRAINT_DEBUG_GLYPH_HALF_LENGTH_PX / context.viewportScale;
  const glyphLineWidth = CONSTRAINT_DEBUG_GLYPH_LINE_WIDTH_PX / context.viewportScale;

  drawConstraintDebugHelperLine(pointA, pointB, context);
  drawConstraintDebugBadge(center, context);
  context.graphics.setStrokeStyle({
    color: CONSTRAINT_DEBUG_GLYPH_COLOR,
    width: glyphLineWidth,
  });

  if (axis === 'horizontal') {
    context.graphics.moveTo(center.x - glyphHalfLength, center.y);
    context.graphics.lineTo(center.x + glyphHalfLength, center.y);
  } else {
    context.graphics.moveTo(center.x, center.y - glyphHalfLength);
    context.graphics.lineTo(center.x, center.y + glyphHalfLength);
  }
  context.graphics.stroke();
}

function drawDistanceConstraintGlyph(
  data: TwoPointConstraintDebugDrawData<DistanceEngineConstraint>,
  context: ConstraintDebugDrawContext,
): void {
  const pointA = data.pointA.toWorld();
  const pointB = data.pointB.toWorld();
  const center = getMidpoint(pointA, pointB);
  const glyphHalfLength = CONSTRAINT_DEBUG_GLYPH_HALF_LENGTH_PX / context.viewportScale;
  const glyphLineWidth = CONSTRAINT_DEBUG_GLYPH_LINE_WIDTH_PX / context.viewportScale;
  const arrowHeadLength = CONSTRAINT_DEBUG_ARROW_HEAD_LENGTH_PX / context.viewportScale;
  const arrowHeadHalfHeight = CONSTRAINT_DEBUG_ARROW_HEAD_HALF_HEIGHT_PX / context.viewportScale;

  const leftX = center.x - glyphHalfLength;
  const rightX = center.x + glyphHalfLength;

  drawConstraintDebugHelperLine(pointA, pointB, context);
  drawConstraintDebugBadge(center, context);
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
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
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
  center: { x: number; y: number },
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

function getMidpoint(pointA: { x: number; y: number }, pointB: { x: number; y: number }) {
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

  useEffect(() => {
    if (!enabled) {
      return;
    }
    console.log('Constraint debug engine constraints:', debugData.engineConstraints);
    console.log('Constraint debug positions:', debugData.positions);
  }, [debugData, enabled]);

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
