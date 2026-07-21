'use client';

import { FederatedPointerEvent, Graphics } from 'pixi.js';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import ConstraintLengthInput, {
  ConstraintLengthInputHandle,
} from '@/app/components/ConstraintLengthInput';
import ConstraintLineMarker from '@/app/components/ConstraintLineMarker';
import DimensionAngle from '@/app/components/DimensionAngle';
import DimensionLine from '@/app/components/DimensionLine';
import DimensionParallel from '@/app/components/DimensionParallel';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { ConstraintComponent } from '@/lib/entity';
import {
  type ColinearConstraintData,
  type Entity,
  type ParallelConstraintData,
  type PerpendicularConstraintData,
} from '@/lib/entity';
import { LinearConstraintData } from '@/lib/entity/constraints/linear';
import { Vector2, round } from '@/lib/math';
import { RendererLayers, SingleLayers } from '@/lib/renderer';
import { Sheet } from '@/lib/sheet/Sheet';
import {
  ColinearConstraintIconConflictTexture,
  ColinearConstraintIconTexture,
  HorizontalConstraintIconConflictTexture,
  HorizontalConstraintIconTexture,
  ParallelConstraintIconConflictTexture,
  ParallelConstraintIconTexture,
  PerpendicularConstraintIconConflictTexture,
  PerpendicularConstraintIconTexture,
  SELECTION_COLOR,
  VertexHandleTexture,
  VerticalConstraintIconConflictTexture,
  VerticalConstraintIconTexture,
} from '@/lib/textures';
import { WorkingConstraint } from '@/lib/tools/types';
import { Length } from '@/lib/units/length';
import type { UnitType } from '@/lib/units/length';
import { ScreenPosition } from '@/lib/viewport/types';
import { HandleSprites } from './HandleSprites';

const ConstraintOverlay: React.FunctionComponent = () => {
  const { geometryStore, viewportScale, selectionManager, toolManager, viewportControls, sheet } =
    useViewportContext();

  const selectedIds = useSelectionManagerSelectedIds();

  const [constraints, setConstraints] = useState<Array<Entity<ConstraintComponent>>>([]);
  const [workingConstraints, setWorkingConstraints] = useState<Array<WorkingConstraint>>([]);
  const rebuildConstraints = useCallback(() => {
    setConstraints(geometryStore.listWithComponent(ConstraintComponent));
  }, [geometryStore]);
  useEffect(() => {
    rebuildConstraints();
    geometryStore.on('geometryAdded', rebuildConstraints);
    geometryStore.on('geometryUpdated', rebuildConstraints);
    geometryStore.on('geometryDeleted', rebuildConstraints);
    geometryStore.on('workingConstraintsChanged', setWorkingConstraints);
    return () => {
      geometryStore.off('geometryAdded', rebuildConstraints);
      geometryStore.off('geometryUpdated', rebuildConstraints);
      geometryStore.off('geometryDeleted', rebuildConstraints);
      geometryStore.off('workingConstraintsChanged', setWorkingConstraints);
    };
  }, [geometryStore, rebuildConstraints]);

  // Track when a user hovers over a constraint
  const [hoveringConstraintLabelId, setHoveringConstraintLabelId] = useState<string | null>(null);
  useEffect(() => {
    const activeTool = toolManager.getActiveTool();
    if (activeTool.type !== 'select') {
      return;
    }

    let cleanup: (() => void) | null = null;

    const changeActiveTool = () => {
      cleanup?.();
      cleanup = null;

      if (activeTool.type === 'select') {
        activeTool.on('hoveringConstraintLabelChange', setHoveringConstraintLabelId);
        cleanup = () => {
          activeTool.off('hoveringConstraintLabelChange', setHoveringConstraintLabelId);
        };
      }
    };

    toolManager.on('toolChange', changeActiveTool);
    return () => {
      toolManager.on('toolChange', changeActiveTool);
      cleanup?.();
    };
  }, [toolManager]);

  const [sheetDefaultUnit, setSheetDefaultUnit] = useState<Sheet['defaultUnit']>(sheet.defaultUnit);
  useEffect(() => {
    const handler = (unit: UnitType) => setSheetDefaultUnit(unit);
    sheet.on('defaultUnitChange', handler);
    return () => {
      sheet.off('defaultUnitChange', handler);
    };
  }, [sheet]);

  const handleConstraintLabelPointerUp = useCallback(
    (e: FederatedPointerEvent, constraintId: Entity<ConstraintComponent>['id']) => {
      if (!viewportControls) {
        return;
      }
      const activeTool = toolManager.getActiveTool();
      if (activeTool.type !== 'select') {
        return;
      }

      activeTool.onConstraintLabelPointerUp(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        constraintId,
        e.shiftKey,
      );
    },
    [toolManager],
  );

  const handleConstraintLabelPointerEnter = useCallback(
    (constraintId: Entity<ConstraintComponent>['id']) => {
      const activeTool = toolManager.getActiveTool();
      if (activeTool.type !== 'select') {
        return;
      }

      activeTool.onConstraintLabelPointerEnter(constraintId);
    },
    [toolManager],
  );

  const handleConstraintLabelPointerLeave = useCallback(() => {
    const activeTool = toolManager.getActiveTool();
    if (activeTool.type !== 'select') {
      return;
    }

    activeTool.onConstraintLabelPointerLeave();
  }, [toolManager]);

  const handleLinearConstraintEndpointPointerDown = useCallback(
    (
      e: FederatedPointerEvent,
      constraintId: Entity<ConstraintComponent>['id'],
      pointKey: 'pointA' | 'pointB',
    ) => {
      if (!viewportControls) {
        return;
      }

      const activeTool = toolManager.getActiveTool();
      if (activeTool.type !== 'select') {
        return;
      }

      activeTool.onConstraintEndpointPointerDown<LinearConstraintData>(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        constraintId,
        pointKey,
      );
    },
    [toolManager],
  );

  const handlePerpendicularConstraintEndpointPointerDown = useCallback(
    (
      e: FederatedPointerEvent,
      constraintId: Entity<ConstraintComponent>['id'],
      pointKey: 'pointA' | 'pointCenter' | 'pointB',
    ) => {
      if (!viewportControls) {
        return;
      }
      const activeTool = toolManager.getActiveTool();
      if (activeTool.type !== 'select') {
        return;
      }
      activeTool.onConstraintEndpointPointerDown<PerpendicularConstraintData>(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        constraintId,
        pointKey,
      );
    },
    [toolManager],
  );

  const handleParallelConstraintEndpointPointerDown = useCallback(
    (
      e: FederatedPointerEvent,
      constraintId: Entity<ConstraintComponent>['id'],
      pointKey: 'pointA' | 'pointB' | 'pointC' | 'pointD',
    ) => {
      if (!viewportControls) {
        return;
      }
      const activeTool = toolManager.getActiveTool();
      if (activeTool.type !== 'select') {
        return;
      }
      activeTool.onConstraintEndpointPointerDown<ParallelConstraintData>(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        constraintId,
        pointKey,
      );
    },
    [toolManager],
  );

  const handleColinearConstraintEndpointPointerDown = useCallback(
    (
      e: FederatedPointerEvent,
      constraintId: Entity<ConstraintComponent>['id'],
      pointKey: 'pointTarget' | 'pointA' | 'pointB',
    ) => {
      if (!viewportControls) {
        return;
      }
      const activeTool = toolManager.getActiveTool();
      if (activeTool.type !== 'select') {
        return;
      }
      activeTool.onConstraintEndpointPointerDown<ColinearConstraintData>(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        constraintId,
        pointKey,
      );
    },
    [toolManager],
  );

  const handleConstraintLabelPointerDown = useCallback(
    (e: FederatedPointerEvent, constraintId: Entity<ConstraintComponent>['id']) => {
      if (!viewportControls) {
        return;
      }
      const activeTool = toolManager.getActiveTool();
      if (activeTool.type !== 'select') {
        return;
      }

      activeTool.onConstraintLabelPointerDown(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        constraintId,
      );
    },
    [selectionManager],
  );

  const PERPENDICULAR_ANGLE_EPSILON = 1e-3;

  const perpendicularRenderAngleMarkerType = useCallback((angleDegrees: number) => {
    const remainder = Math.abs(angleDegrees % 90);
    const oppositeRemainder = Math.abs(angleDegrees % 180);
    if (
      remainder < PERPENDICULAR_ANGLE_EPSILON &&
      oppositeRemainder > PERPENDICULAR_ANGLE_EPSILON
    ) {
      return 'elbow';
    } else {
      return 'conflict';
    }
  }, []);

  return (
    <>
      {constraints.map((constraintGeom) => {
        const c = ConstraintComponent.get(constraintGeom);
        if (workingConstraints.find((wc) => wc.shadowsConstraintId === constraintGeom.id)) {
          // A working constraint shadows this constraint, so skip rendering
          // This can happen when a user double clicks on a constraint to edit it
          return null;
        }

        const isSelected = selectedIds.includes(constraintGeom.id);
        switch (c.type) {
          case 'linear': {
            const resolvedA = geometryStore.resolveConstraintEndpoint(c.pointA);
            const resolvedB = geometryStore.resolveConstraintEndpoint(c.pointB);
            if (!resolvedA || !resolvedB) {
              // Referenced geometry no longer exists, skip rendering
              return null;
            }

            // FIXME: make this use the ConstraintEngine.isInConflict stuff
            const axisLength = c.constrainedLength.toSheetUnits(sheet.defaultUnit).magnitude;
            let actualLength: number;
            if (c.axis === 'x') {
              actualLength = Math.abs(resolvedB.x - resolvedA.x);
            } else if (c.axis === 'y') {
              actualLength = Math.abs(resolvedB.y - resolvedA.y);
            } else {
              actualLength = Vector2.distance(resolvedA, resolvedB);
            }
            const isInConflict =
              Math.abs(actualLength - axisLength) > 1e-3; /* FIXME: use sheet level epsilon */

            let color: number | undefined;
            let bgColor: number | undefined;
            let lineWidthPx: number | undefined;
            if (isInConflict) {
              color = 0xe5484d;
              bgColor = 0xe5484d;
            } else if (isSelected) {
              color = SELECTION_COLOR;
              bgColor = SELECTION_COLOR;
              lineWidthPx = 2;
            }
            if (hoveringConstraintLabelId === constraintGeom.id) {
              // When hovering, make the line thicker.
              lineWidthPx = 2;
            }

            return (
              <Fragment key={constraintGeom.id}>
                <DimensionLine
                  key={constraintGeom.id}
                  pointA={resolvedA}
                  pointB={resolvedB}
                  viewportScale={viewportScale}
                  sheetDefaultUnit={sheetDefaultUnit}
                  offsetPx={c.connectorLineOffsetPx}
                  axis={c.axis}
                  lineWidthPx={lineWidthPx}
                  color={color}
                  bgColor={bgColor}
                  showConflictIcon={isInConflict}
                  onPointerDown={(e) => handleConstraintLabelPointerDown(e, constraintGeom.id)}
                  onPointerUp={(e) => handleConstraintLabelPointerUp(e, constraintGeom.id)}
                  onPointerEnter={() => handleConstraintLabelPointerEnter(constraintGeom.id)}
                  onPointerLeave={handleConstraintLabelPointerLeave}
                />
                {isSelected ? (
                  <HandleSprites
                    points={[resolvedA, resolvedB]}
                    handleTexture={VertexHandleTexture.get()}
                    viewportScale={viewportScale}
                    onHandlePointerDown={(e, index) =>
                      handleLinearConstraintEndpointPointerDown(
                        e,
                        constraintGeom.id,
                        index === 0 ? 'pointA' : 'pointB',
                      )
                    }
                    // onHandleEnter={onVertexEnter}
                    // onHandleLeave={onVertexLeave}
                    // isDragging={isDragging}
                  />
                ) : null}
              </Fragment>
            );
          }
          case 'perpendicular': {
            const resolvedA = geometryStore.resolveConstraintEndpoint(c.pointA);
            const resolvedCenter = geometryStore.resolveConstraintEndpoint(c.pointCenter);
            const resolvedB = geometryStore.resolveConstraintEndpoint(c.pointB);
            if (!resolvedA || !resolvedCenter || !resolvedB) {
              // Referenced geometry no longer exists, skip rendering
              return null;
            }

            return (
              <Fragment key={constraintGeom.id}>
                <DimensionAngle
                  key={constraintGeom.id}
                  pointA={resolvedA}
                  pointCenter={resolvedCenter}
                  pointB={resolvedB}
                  viewportScale={viewportScale}
                  lineWidthPx={
                    isSelected || hoveringConstraintLabelId === constraintGeom.id ? 2 : undefined
                  }
                  color={isSelected ? SELECTION_COLOR : undefined}
                  renderAngleMarkerType={perpendicularRenderAngleMarkerType}
                  icon={PerpendicularConstraintIconTexture}
                  conflictIcon={PerpendicularConstraintIconConflictTexture}
                  onPointerDown={(e) => handleConstraintLabelPointerDown(e, constraintGeom.id)}
                  onPointerUp={(e) => handleConstraintLabelPointerUp(e, constraintGeom.id)}
                  onPointerEnter={() => handleConstraintLabelPointerEnter(constraintGeom.id)}
                  onPointerLeave={handleConstraintLabelPointerLeave}
                />
                {isSelected ? (
                  <HandleSprites
                    points={[resolvedA, resolvedCenter, resolvedB]}
                    handleTexture={VertexHandleTexture.get()}
                    viewportScale={viewportScale}
                    onHandlePointerDown={(e, index) => {
                      let point;
                      switch (index) {
                        case 0:
                          point = 'pointA' as const;
                          break;
                        case 1:
                          point = 'pointCenter' as const;
                          break;
                        case 2:
                          point = 'pointB' as const;
                          break;
                        default:
                          throw new Error(`Unknown point index ${index}`);
                      }

                      handlePerpendicularConstraintEndpointPointerDown(e, constraintGeom.id, point);
                    }}
                    // onHandleEnter={onVertexEnter}
                    // onHandleLeave={onVertexLeave}
                    // isDragging={isDragging}
                  />
                ) : null}
              </Fragment>
            );
          }
          case 'parallel': {
            const resolvedA = geometryStore.resolveConstraintEndpoint(c.pointA);
            const resolvedB = geometryStore.resolveConstraintEndpoint(c.pointB);
            const resolvedC = geometryStore.resolveConstraintEndpoint(c.pointC);
            const resolvedD = geometryStore.resolveConstraintEndpoint(c.pointD);
            if (!resolvedA || !resolvedB || !resolvedC || !resolvedD) {
              return null;
            }

            // Conflict check: segments are not parallel if cross product of direction vectors is non-zero
            const dxAB = resolvedB.x - resolvedA.x;
            const dyAB = resolvedB.y - resolvedA.y;
            const dxCD = resolvedD.x - resolvedC.x;
            const dyCD = resolvedD.y - resolvedC.y;
            const cross = dxAB * dyCD - dyAB * dxCD;
            const isInConflict = Math.abs(cross) > 1e-3;

            return (
              <Fragment key={constraintGeom.id}>
                <DimensionParallel
                  key={constraintGeom.id}
                  pointA={resolvedA}
                  pointB={resolvedB}
                  pointC={resolvedC}
                  pointD={resolvedD}
                  viewportScale={viewportScale}
                  lineWidthPx={
                    isSelected || hoveringConstraintLabelId === constraintGeom.id ? 2 : undefined
                  }
                  color={isSelected ? SELECTION_COLOR : undefined}
                  icon={ParallelConstraintIconTexture}
                  conflictIcon={ParallelConstraintIconConflictTexture}
                  inConflict={isInConflict}
                  onPointerDown={(e) => handleConstraintLabelPointerDown(e, constraintGeom.id)}
                  onPointerUp={(e) => handleConstraintLabelPointerUp(e, constraintGeom.id)}
                  onPointerEnter={() => handleConstraintLabelPointerEnter(constraintGeom.id)}
                  onPointerLeave={handleConstraintLabelPointerLeave}
                />
                {isSelected ? (
                  <HandleSprites
                    points={[resolvedA, resolvedB, resolvedC, resolvedD]}
                    handleTexture={VertexHandleTexture.get()}
                    viewportScale={viewportScale}
                    onHandlePointerDown={(e, index) => {
                      let point;
                      switch (index) {
                        case 0:
                          point = 'pointA' as const;
                          break;
                        case 1:
                          point = 'pointB' as const;
                          break;
                        case 2:
                          point = 'pointC' as const;
                          break;
                        case 3:
                          point = 'pointD' as const;
                          break;
                        default:
                          throw new Error(`Unknown point index ${index}`);
                      }
                      handleParallelConstraintEndpointPointerDown(e, constraintGeom.id, point);
                    }}
                  />
                ) : null}
              </Fragment>
            );
          }
          case 'horizontal': {
            const resolvedA = geometryStore.resolveConstraintEndpoint(c.pointA);
            const resolvedB = geometryStore.resolveConstraintEndpoint(c.pointB);
            if (!resolvedA || !resolvedB) {
              return null;
            }

            const dy = Math.abs(resolvedB.y - resolvedA.y);
            const isInConflict = dy > 1e-3;

            return (
              <Fragment key={constraintGeom.id}>
                <ConstraintLineMarker
                  pointA={resolvedA}
                  pointB={resolvedB}
                  viewportScale={viewportScale}
                  icon={HorizontalConstraintIconTexture}
                  conflictIcon={HorizontalConstraintIconConflictTexture}
                  lineWidthPx={
                    isSelected || hoveringConstraintLabelId === constraintGeom.id ? 2 : undefined
                  }
                  color={isInConflict ? 0xe5484d : isSelected ? SELECTION_COLOR : undefined}
                  inConflict={isInConflict}
                  onPointerDown={(e) => handleConstraintLabelPointerDown(e, constraintGeom.id)}
                  onPointerUp={(e) => handleConstraintLabelPointerUp(e, constraintGeom.id)}
                  onPointerEnter={() => handleConstraintLabelPointerEnter(constraintGeom.id)}
                  onPointerLeave={handleConstraintLabelPointerLeave}
                />
                {isSelected ? (
                  <HandleSprites
                    points={[resolvedA, resolvedB]}
                    handleTexture={VertexHandleTexture.get()}
                    viewportScale={viewportScale}
                    onHandlePointerDown={(e, index) =>
                      handleLinearConstraintEndpointPointerDown(
                        e,
                        constraintGeom.id,
                        index === 0 ? 'pointA' : 'pointB',
                      )
                    }
                  />
                ) : null}
              </Fragment>
            );
          }
          case 'vertical': {
            const resolvedA = geometryStore.resolveConstraintEndpoint(c.pointA);
            const resolvedB = geometryStore.resolveConstraintEndpoint(c.pointB);
            if (!resolvedA || !resolvedB) {
              return null;
            }

            const dx = Math.abs(resolvedB.x - resolvedA.x);
            const isInConflict = dx > 1e-3;

            return (
              <Fragment key={constraintGeom.id}>
                <ConstraintLineMarker
                  pointA={resolvedA}
                  pointB={resolvedB}
                  viewportScale={viewportScale}
                  icon={VerticalConstraintIconTexture}
                  conflictIcon={VerticalConstraintIconConflictTexture}
                  lineWidthPx={
                    isSelected || hoveringConstraintLabelId === constraintGeom.id ? 2 : undefined
                  }
                  color={isInConflict ? 0xe5484d : isSelected ? SELECTION_COLOR : undefined}
                  inConflict={isInConflict}
                  onPointerDown={(e) => handleConstraintLabelPointerDown(e, constraintGeom.id)}
                  onPointerUp={(e) => handleConstraintLabelPointerUp(e, constraintGeom.id)}
                  onPointerEnter={() => handleConstraintLabelPointerEnter(constraintGeom.id)}
                  onPointerLeave={handleConstraintLabelPointerLeave}
                />
                {isSelected ? (
                  <HandleSprites
                    points={[resolvedA, resolvedB]}
                    handleTexture={VertexHandleTexture.get()}
                    viewportScale={viewportScale}
                    onHandlePointerDown={(e, index) =>
                      handleLinearConstraintEndpointPointerDown(
                        e,
                        constraintGeom.id,
                        index === 0 ? 'pointA' : 'pointB',
                      )
                    }
                  />
                ) : null}
              </Fragment>
            );
          }
          case 'colinear': {
            const resolvedTarget = geometryStore.resolveConstraintEndpoint(c.pointTarget);
            const resolvedA = geometryStore.resolveConstraintEndpoint(c.pointA);
            const resolvedB = geometryStore.resolveConstraintEndpoint(c.pointB);
            if (!resolvedTarget || !resolvedA || !resolvedB) {
              return null;
            }

            // Conflict check: cross product of (B-A) and (target-A) should be zero
            const cross =
              (resolvedB.x - resolvedA.x) * (resolvedTarget.y - resolvedA.y) -
              (resolvedB.y - resolvedA.y) * (resolvedTarget.x - resolvedA.x);
            const isInConflict = Math.abs(cross) > 1e-3;

            const targetColor = isInConflict ? 0xe5484d : isSelected ? SELECTION_COLOR : 0x666666;

            const targetWorld = resolvedTarget.toWorld();
            const targetRadius = 4 / viewportScale;

            return (
              <Fragment key={constraintGeom.id}>
                <ConstraintLineMarker
                  pointA={resolvedA}
                  pointB={resolvedB}
                  viewportScale={viewportScale}
                  icon={ColinearConstraintIconTexture}
                  conflictIcon={ColinearConstraintIconConflictTexture}
                  lineWidthPx={
                    isSelected || hoveringConstraintLabelId === constraintGeom.id ? 2 : undefined
                  }
                  color={isInConflict ? 0xe5484d : isSelected ? SELECTION_COLOR : undefined}
                  inConflict={isInConflict}
                  onPointerDown={(e) => handleConstraintLabelPointerDown(e, constraintGeom.id)}
                  onPointerUp={(e) => handleConstraintLabelPointerUp(e, constraintGeom.id)}
                  onPointerEnter={() => handleConstraintLabelPointerEnter(constraintGeom.id)}
                  onPointerLeave={handleConstraintLabelPointerLeave}
                />
                <pixiGraphics
                  draw={(g: Graphics) => {
                    g.clear();
                    g.setFillStyle({ color: targetColor });
                    g.beginPath();
                    g.arc(targetWorld.x, targetWorld.y, targetRadius, 0, Math.PI * 2);
                    g.closePath();
                    g.fill();
                  }}
                  onPointerDown={(e: FederatedPointerEvent) =>
                    handleConstraintLabelPointerDown(e, constraintGeom.id)
                  }
                  onPointerUp={(e: FederatedPointerEvent) =>
                    handleConstraintLabelPointerUp(e, constraintGeom.id)
                  }
                  eventMode="static"
                />
                {isSelected ? (
                  <HandleSprites
                    points={[resolvedTarget, resolvedA, resolvedB]}
                    handleTexture={VertexHandleTexture.get()}
                    viewportScale={viewportScale}
                    onHandlePointerDown={(e, index) => {
                      let point;
                      switch (index) {
                        case 0:
                          point = 'pointTarget' as const;
                          break;
                        case 1:
                          point = 'pointA' as const;
                          break;
                        case 2:
                          point = 'pointB' as const;
                          break;
                        default:
                          throw new Error(`Unknown point index ${index}`);
                      }
                      handleColinearConstraintEndpointPointerDown(e, constraintGeom.id, point);
                    }}
                  />
                ) : null}
              </Fragment>
            );
          }
        }
      })}
      {workingConstraints.map((workingConstraint, index) => {
        switch (workingConstraint.type) {
          case 'linear':
            const wcResolvedA = geometryStore.resolveConstraintEndpoint(workingConstraint.pointA);
            const wcResolvedB = geometryStore.resolveConstraintEndpoint(workingConstraint.pointB);
            if (!wcResolvedA || !wcResolvedB) {
              return null;
            }
            return (
              <DimensionLine
                key={index}
                pointA={wcResolvedA}
                pointB={wcResolvedB}
                viewportScale={viewportScale}
                sheetDefaultUnit={sheetDefaultUnit}
                offsetPx={-1 * workingConstraint.connectorLineOffsetPx}
                axis={workingConstraint.axis}
                showLabel={false}
              />
            );
          case 'perpendicular': {
            const resolvedA = geometryStore.resolveConstraintEndpoint(workingConstraint.pointA);
            const resolvedCenter = geometryStore.resolveConstraintEndpoint(
              workingConstraint.pointCenter,
            );
            const resolvedB = geometryStore.resolveConstraintEndpoint(workingConstraint.pointB);
            if (!resolvedA || !resolvedCenter || !resolvedB) {
              return null;
            }

            return (
              <DimensionAngle
                key={index}
                pointA={resolvedA}
                pointCenter={resolvedCenter}
                pointB={resolvedB}
                viewportScale={viewportScale}
                icon={PerpendicularConstraintIconTexture}
                conflictIcon={PerpendicularConstraintIconConflictTexture}
              />
            );
          }
          case 'parallel': {
            const resolvedA = geometryStore.resolveConstraintEndpoint(workingConstraint.pointA);
            const resolvedB = geometryStore.resolveConstraintEndpoint(workingConstraint.pointB);
            const resolvedC = geometryStore.resolveConstraintEndpoint(workingConstraint.pointC);
            const resolvedD = geometryStore.resolveConstraintEndpoint(workingConstraint.pointD);
            if (!resolvedA || !resolvedB || !resolvedC || !resolvedD) {
              return null;
            }

            return (
              <DimensionParallel
                key={index}
                pointA={resolvedA}
                pointB={resolvedB}
                pointC={resolvedC}
                pointD={resolvedD}
                viewportScale={viewportScale}
                icon={ParallelConstraintIconTexture}
                conflictIcon={ParallelConstraintIconConflictTexture}
              />
            );
          }
          case 'horizontal': {
            const resolvedA = geometryStore.resolveConstraintEndpoint(workingConstraint.pointA);
            const resolvedB = geometryStore.resolveConstraintEndpoint(workingConstraint.pointB);
            if (!resolvedA || !resolvedB) {
              return null;
            }
            return (
              <ConstraintLineMarker
                key={index}
                pointA={resolvedA}
                pointB={resolvedB}
                viewportScale={viewportScale}
                icon={HorizontalConstraintIconTexture}
                conflictIcon={HorizontalConstraintIconConflictTexture}
              />
            );
          }
          case 'vertical': {
            const resolvedA = geometryStore.resolveConstraintEndpoint(workingConstraint.pointA);
            const resolvedB = geometryStore.resolveConstraintEndpoint(workingConstraint.pointB);
            if (!resolvedA || !resolvedB) {
              return null;
            }
            return (
              <ConstraintLineMarker
                key={index}
                pointA={resolvedA}
                pointB={resolvedB}
                viewportScale={viewportScale}
                icon={VerticalConstraintIconTexture}
                conflictIcon={VerticalConstraintIconConflictTexture}
              />
            );
          }
          case 'colinear': {
            if (!workingConstraint.pointA || !workingConstraint.pointB) {
              // Before both line points are placed: only show the target point
              const resolvedTarget = geometryStore.resolveConstraintEndpoint(
                workingConstraint.pointTarget,
              );
              if (!resolvedTarget) {
                return null;
              }
              const targetWorld = resolvedTarget.toWorld();
              const targetRadius = 4 / viewportScale;
              return (
                <pixiGraphics
                  key={index}
                  draw={(g: Graphics) => {
                    g.clear();
                    g.setFillStyle({ color: 0x666666 });
                    g.beginPath();
                    g.arc(targetWorld.x, targetWorld.y, targetRadius, 0, Math.PI * 2);
                    g.closePath();
                    g.fill();
                  }}
                  eventMode="none"
                />
              );
            }

            const resolvedTarget = geometryStore.resolveConstraintEndpoint(
              workingConstraint.pointTarget,
            );
            const resolvedA = geometryStore.resolveConstraintEndpoint(workingConstraint.pointA);
            const resolvedB = geometryStore.resolveConstraintEndpoint(workingConstraint.pointB);
            if (!resolvedTarget || !resolvedA || !resolvedB) {
              return null;
            }

            const targetWorld = resolvedTarget.toWorld();
            const targetRadius = 4 / viewportScale;

            return (
              <Fragment key={index}>
                <ConstraintLineMarker
                  pointA={resolvedA}
                  pointB={resolvedB}
                  viewportScale={viewportScale}
                  icon={ColinearConstraintIconTexture}
                  conflictIcon={ColinearConstraintIconConflictTexture}
                />
                <pixiGraphics
                  draw={(g: Graphics) => {
                    g.clear();
                    g.setFillStyle({ color: 0x666666 });
                    g.beginPath();
                    g.arc(targetWorld.x, targetWorld.y, targetRadius, 0, Math.PI * 2);
                    g.closePath();
                    g.fill();
                  }}
                  eventMode="none"
                />
              </Fragment>
            );
          }
        }
      })}
    </>
  );
};

const ConstraintTooltips: React.FunctionComponent = () => {
  const { sheet, geometryStore, viewportControls } = useViewportContext();

  const [workingConstraints, setWorkingConstraints] = useState<Array<WorkingConstraint>>([]);
  useEffect(() => {
    geometryStore.on('workingConstraintsChanged', setWorkingConstraints);
    return () => {
      geometryStore.off('workingConstraintsChanged', setWorkingConstraints);
    };
  }, [geometryStore]);

  const [sheetDefaultUnit, setSheetDefaultUnit] = useState<UnitType>(sheet.defaultUnit);
  useEffect(() => {
    const handler = (unit: UnitType) => setSheetDefaultUnit(unit);
    sheet.on('defaultUnitChange', handler);
    return () => {
      sheet.off('defaultUnitChange', handler);
    };
  }, [sheet]);

  // Keep the textbox positioned at the midpoint of the working linear constraint
  const constraintDivsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  useEffect(() => {
    if (workingConstraints.length === 0) {
      return;
    }
    if (!viewportControls) {
      return;
    }

    let frameId: ReturnType<typeof window.requestAnimationFrame> | null = null;
    const runFrame = () => {
      frameId = null;

      // If nothing is focused, then automatically focus the first non disabled constraint
      // This works around a user accidentally defocusing the text box somehow
      if (document.activeElement === document.body) {
        for (let i = 0; i < workingConstraints.length; i += 1) {
          if (!workingConstraints[i].disabled) {
            constraintLengthInputsRef.current.get(i)?.focus();
            break;
          }
        }
      }

      // Update all working cosntraint text boxes to be at the right spots
      for (let i = 0; i < workingConstraints.length; i += 1) {
        const ref = constraintDivsRef.current.get(i);
        if (!ref) {
          continue;
        }

        const workingConstraint = workingConstraints[i];
        switch (workingConstraint.type) {
          case 'linear':
            const resolvedA = geometryStore.resolveConstraintEndpoint(workingConstraint.pointA);
            const resolvedB = geometryStore.resolveConstraintEndpoint(workingConstraint.pointB);
            if (!resolvedA || !resolvedB) {
              continue;
            }
            const pos = Vector2.midpoint(resolvedA, resolvedB);
            const screenPos = pos.toWorld().toScreen(viewportControls.getState().viewport);
            ref.style.left = `${screenPos.x}px`;
            ref.style.top = `${screenPos.y}px`;
            break;
        }
      }
      frameId = window.requestAnimationFrame(runFrame);
    };
    frameId = window.requestAnimationFrame(runFrame);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [workingConstraints, viewportControls]);

  // When the workingConstraints goes from 0 -> n, focus the first constraint
  const constraintLengthInputsRef = useRef<Map<number, ConstraintLengthInputHandle>>(new Map());
  const workingConstraintsEmpty = workingConstraints.length === 0;
  useEffect(() => {
    if (workingConstraintsEmpty) {
      return;
    }
    const firstInput = constraintLengthInputsRef.current.get(0);
    if (!firstInput) {
      return;
    }

    setTimeout(() => {
      firstInput.focus();
      firstInput.select();
    }, 0);
  }, [workingConstraintsEmpty]);

  if (!viewportControls) {
    return null;
  }

  return (
    <>
      {workingConstraints.map((workingConstraint, index) => {
        switch (workingConstraint.type) {
          case 'linear': {
            const wcResolvedA = geometryStore.resolveConstraintEndpoint(workingConstraint.pointA);
            const wcResolvedB = geometryStore.resolveConstraintEndpoint(workingConstraint.pointB);
            if (!wcResolvedA || !wcResolvedB) {
              return null;
            }
            const distanceBetweenPoints = Length.fromSheetUnits(
              sheetDefaultUnit,
              Vector2.distance(wcResolvedA, wcResolvedB),
            ).magnitude;

            // If the constraint was just disabled, but it was focused, then move focus to the first
            // non disabled c.
            if (
              workingConstraint.disabled &&
              constraintLengthInputsRef.current.get(index)?.isFocused()
            ) {
              for (let i = 0; i < workingConstraints.length; i += 1) {
                if (!workingConstraints[i].disabled) {
                  constraintLengthInputsRef.current.get(i)?.focus();
                  break;
                }
              }
            }

            return (
              <div
                key={index}
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -${workingConstraint.connectorLineOffsetPx + 14}px)`, // 14px = height of ConstraintLengthInput / 2
                }}
                ref={(divElement) => {
                  if (divElement) {
                    constraintDivsRef.current.set(index, divElement);
                  } else {
                    constraintDivsRef.current.delete(index);
                  }
                }}
              >
                <ConstraintLengthInput
                  ref={(r) => {
                    if (r) {
                      constraintLengthInputsRef.current.set(index, r);
                    } else {
                      constraintLengthInputsRef.current.delete(index);
                    }
                  }}
                  value={workingConstraint.constrainedLength}
                  disabled={workingConstraint.disabled}
                  onChange={(value) => {
                    geometryStore.setWorkingConstraints((old) => {
                      const newWorkingConstraints = old.slice();
                      const target = newWorkingConstraints[index];
                      if (target.type === 'linear') {
                        newWorkingConstraints[index] = {
                          ...target,
                          constrainedLength: value,
                        };
                      }
                      return newWorkingConstraints;
                    });
                  }}
                  placeholder={`${round(distanceBetweenPoints, 2)}`}
                  onTabPress={
                    workingConstraints.filter((c) => !c.disabled).length > 1
                      ? () => {
                          // When tab is pressed, focus the next constraint input (wrapping around at end)
                          let nextIndex = (index + 1) % workingConstraints.length;
                          constraintLengthInputsRef.current.get(nextIndex)?.focus();
                        }
                      : undefined
                  }
                  defaultUnit={sheetDefaultUnit}
                />
              </div>
            );
          }
          case 'perpendicular':
          case 'parallel':
          case 'vertical':
          case 'horizontal':
          case 'colinear':
            return null;
          default:
            workingConstraint satisfies never;
            break;
        }
      })}
    </>
  );
};

/** Renders all constraints currently on the sheet. */
export const ConstraintLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <ConstraintOverlay />,
  [RendererLayers.Tooltips]: <ConstraintTooltips />,
};
