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
      assertNever(constraint);
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

  scaffoldConstraintDebugDraw(context, data);
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

  scaffoldConstraintDebugDraw(context, data);
}

function drawVerticalConstraintDebug(
  constraint: VerticalEngingConstraint,
  context: ConstraintDebugDrawContext,
): void {
  const data = resolveTwoPointConstraintDebugDrawData(constraint, context.positions);
  if (!data) {
    return;
  }

  scaffoldConstraintDebugDraw(context, data);
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

function assertNever(value: never): never {
  throw new Error(`Unhandled constraint debug renderer type: ${JSON.stringify(value)}`);
}

const ConstraintDebugRendererOverlays: React.FunctionComponent = () => {
  const { geometryStore, sheet, viewportScale } = useViewportContext();
  const [debugData, setDebugData] = useState<ConstraintDebugData>(() =>
    computeConstraintDebugData(geometryStore, sheet.defaultUnit),
  );
  const enabled = useConstraintDebugViewEnabled();

  useEffect(() => {
    const updateDebugData = () => {
      setDebugData(computeConstraintDebugData(geometryStore, sheet.defaultUnit));
    };

    geometryStore.on('constraintsChanged', updateDebugData);
    geometryStore.dcelIndex.dcel.on('handleHalfEdgesChange', updateDebugData);
    sheet.on('defaultUnitChange', updateDebugData);
    updateDebugData();

    return () => {
      geometryStore.off('constraintsChanged', updateDebugData);
      geometryStore.dcelIndex.dcel.off('handleHalfEdgesChange', updateDebugData);
      sheet.off('defaultUnitChange', updateDebugData);
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
