'use client';

import { FederatedPointerEvent } from 'pixi.js';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import ConstraintLengthInput, {
  ConstraintLengthInputHandle,
} from '@/app/components/ConstraintLengthInput';
import DimensionAngle from '@/app/components/DimensionAngle';
import DimensionLine from '@/app/components/DimensionLine';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { type Constraint, LinearConstraint, PerpendicularConstraint } from '@/lib/geometry';
import { distance, midPoint, round } from '@/lib/math';
import { RendererLayers, SingleLayers } from '@/lib/renderer';
import { Sheet } from '@/lib/sheet/Sheet';
import { SELECTION_COLOR, getVertexHandleTexture } from '@/lib/textures';
import { WorkingConstraint } from '@/lib/tools/types';
import { Length } from '@/lib/units/length';
import type { UnitType } from '@/lib/units/length';
import { ScreenPosition } from '@/lib/viewport/types';
import { HandleSprites } from './HandleSprites';

const ConstraintOverlay: React.FunctionComponent = () => {
  const { geometryStore, viewportScale, selectionManager, toolManager, viewportControls, sheet } =
    useViewportContext();

  const selectedIds = useSelectionManagerSelectedIds();

  const [constraints, setConstraints] = useState<Array<Constraint>>([]);
  const [workingConstraints, setWorkingConstraints] = useState<Array<WorkingConstraint>>([]);
  useEffect(() => {
    geometryStore.on('constraintsChanged', setConstraints);
    geometryStore.on('workingConstraintsChanged', setWorkingConstraints);
    return () => {
      geometryStore.off('constraintsChanged', setConstraints);
      geometryStore.off('workingConstraintsChanged', setWorkingConstraints);
    };
  }, [geometryStore]);

  const [sheetDefaultUnit, setSheetDefaultUnit] = useState<Sheet['defaultUnit']>(sheet.defaultUnit);
  useEffect(() => {
    const handler = (unit: UnitType) => setSheetDefaultUnit(unit);
    sheet.on('defaultUnitChange', handler);
    return () => {
      sheet.off('defaultUnitChange', handler);
    };
  }, [sheet]);

  const handleConstraintLabelPointerUp = useCallback(
    (e: FederatedPointerEvent, constraintId: Constraint['id']) => {
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
    [selectionManager],
  );

  const handleLinearConstraintEndpointPointerDown = useCallback(
    (e: FederatedPointerEvent, constraintId: Constraint['id'], pointKey: 'pointA' | 'pointB') => {
      if (!viewportControls) {
        return;
      }

      const activeTool = toolManager.getActiveTool();
      if (activeTool.type !== 'select') {
        return;
      }

      activeTool.onConstraintEndpointPointerDown<LinearConstraint>(
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
      constraintId: Constraint['id'],
      pointKey: 'pointA' | 'pointCenter' | 'pointB',
    ) => {
      if (!viewportControls) {
        return;
      }
      const activeTool = toolManager.getActiveTool();
      if (activeTool.type !== 'select') {
        return;
      }
      activeTool.onConstraintEndpointPointerDown<PerpendicularConstraint>(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        constraintId,
        pointKey,
      );
    },
    [toolManager],
  );

  const handleConstraintLabelPointerDown = useCallback(
    (e: FederatedPointerEvent, constraintId: Constraint['id']) => {
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

  const perpendicularRenderAngleMarkerType = useCallback((angleDegrees: number) => {
    if (angleDegrees % 90 === 0 && angleDegrees % 180 !== 0) {
      return 'elbow';
    } else {
      return 'conflict';
    }
  }, []);

  return (
    <>
      {constraints.map((constraint) => {
        if (workingConstraints.find((wc) => wc.shadowsConstraintId === constraint.id)) {
          // A working constraint shadows this constraint, so skip rendering
          // This can happen when a user double clicks on a constraint to edit it
          return null;
        }

        const isSelected = selectedIds.includes(constraint.id);
        switch (constraint.type) {
          case 'linear': {
            const resolvedA = geometryStore.resolveConstraintEndpoint(constraint.pointA);
            const resolvedB = geometryStore.resolveConstraintEndpoint(constraint.pointB);
            if (!resolvedA || !resolvedB) {
              // Referenced geometry no longer exists, skip rendering
              return null;
            }

            // FIXME: make this use the ConstraintEngine.isInConflict stuff
            const isInConflict =
              Math.abs(
                distance(resolvedA, resolvedB) -
                  constraint.constrainedLength.toSheetUnits(sheet.defaultUnit).magnitude,
              ) > 1e-3; /* FIXME: use sheet level epsilon */

            return (
              <Fragment key={constraint.id}>
                <DimensionLine
                  key={constraint.id}
                  pointA={resolvedA}
                  pointB={resolvedB}
                  viewportScale={viewportScale}
                  sheetDefaultUnit={sheetDefaultUnit}
                  offsetPx={constraint.connectorLineOffsetPx}
                  lineWidthPx={isSelected ? 2 : undefined}
                  color={isInConflict ? 0xe5484d : isSelected ? SELECTION_COLOR : undefined}
                  bgColor={isInConflict ? 0xe5484d : isSelected ? SELECTION_COLOR : undefined}
                  showConflictIcon={isInConflict}
                  onPointerDown={(e) => handleConstraintLabelPointerDown(e, constraint.id)}
                  onPointerUp={(e) => handleConstraintLabelPointerUp(e, constraint.id)}
                />
                {isSelected ? (
                  <HandleSprites
                    points={[resolvedA, resolvedB]}
                    handleTexture={getVertexHandleTexture()}
                    viewportScale={viewportScale}
                    onHandlePointerDown={(e, index) =>
                      handleLinearConstraintEndpointPointerDown(
                        e,
                        constraint.id,
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
            const resolvedA = geometryStore.resolveConstraintEndpoint(constraint.pointA);
            const resolvedCenter = geometryStore.resolveConstraintEndpoint(constraint.pointCenter);
            const resolvedB = geometryStore.resolveConstraintEndpoint(constraint.pointB);
            if (!resolvedA || !resolvedCenter || !resolvedB) {
              // Referenced geometry no longer exists, skip rendering
              return null;
            }

            return (
              <Fragment key={constraint.id}>
                <DimensionAngle
                  key={constraint.id}
                  pointA={resolvedA}
                  pointCenter={resolvedCenter}
                  pointB={resolvedB}
                  viewportScale={viewportScale}
                  lineWidthPx={isSelected ? 2 : undefined}
                  color={isSelected ? SELECTION_COLOR : undefined}
                  renderAngleMarkerType={perpendicularRenderAngleMarkerType}
                  onPointerDown={(e) => handleConstraintLabelPointerDown(e, constraint.id)}
                  onPointerUp={(e) => handleConstraintLabelPointerUp(e, constraint.id)}
                />
                {isSelected ? (
                  <HandleSprites
                    points={[resolvedA, resolvedCenter, resolvedB]}
                    handleTexture={getVertexHandleTexture()}
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

                      handlePerpendicularConstraintEndpointPointerDown(e, constraint.id, point);
                    }}
                    // onHandleEnter={onVertexEnter}
                    // onHandleLeave={onVertexLeave}
                    // isDragging={isDragging}
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
                showLabel={false}
              />
            );
          case 'perpendicular': {
            const resolvedA = geometryStore.resolveConstraintEndpoint(workingConstraint.pointA);
            const resolvedCenter = geometryStore.resolveConstraintEndpoint(workingConstraint.pointCenter);
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
              />
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
            const pos = midPoint(resolvedA, resolvedB);
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
              distance(wcResolvedA, wcResolvedB),
            ).magnitude;

            // If the constraint was just disabled, but it was focused, then move focus to the first
            // non disabled constraint.
            if (workingConstraint.disabled && constraintLengthInputsRef.current.get(index)?.isFocused()) {
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
            return null;
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
