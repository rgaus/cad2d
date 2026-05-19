"use client";

import { useEffect, useRef, useState } from "react";
import { type Constraint } from "@/lib/geometry/types";
import DimensionLineConstrait from "@/app/components/DimensionLineConstrait";
import { useViewportContext } from "@/contexts/viewport-context";
import { RendererLayers, SingleLayers } from "@/lib/renderer";
import { WorkingConstraint } from "@/lib/tools/types";
import { distance, midPoint, round } from "@/lib/math";
import ConstraintLengthInput, { ConstraintLengthInputHandle } from "@/app/components/ConstraintLengthInput";
import { Length } from "@/lib/units/length";

const ConstraintOverlay: React.FunctionComponent = () => {
  const {
    geometryStore,
    viewportScale,
    sheet,
  } = useViewportContext();

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

  return (
    <>
      {constraints.map((constraint) => {
        return (
          <DimensionLineConstrait
            key={constraint.id}
            pointA={constraint.pointA}
            pointB={constraint.pointB}
            viewportScale={viewportScale}
            sheet={sheet}
            offsetPx={constraint.connectorLineOffsetPx}
          />
        );
      })}
      {workingConstraints.map((workingConstraint, index) => {
        return (
          <DimensionLineConstrait
            key={index}
            pointA={workingConstraint.pointA}
            pointB={workingConstraint.pointB}
            viewportScale={viewportScale}
            sheet={sheet}
            showLabel={false}
            offsetPx={12}
          />
        );
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
      for (let i = 0; i < workingConstraints.length; i += 1) {
        const ref = constraintDivsRef.current.get(i);
        if (!ref) {
          continue;
        }

        const workingConstraint = workingConstraints[i];
        switch (workingConstraint.type) {
          case "linear":
            const pos = midPoint(workingConstraint.pointA, workingConstraint.pointB);
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
  }, [workingConstraintsEmpty])

  if (!viewportControls) {
    return null;
  }

  return (
    <>
      {workingConstraints.map((workingConstraint, index) => {
        switch (workingConstraint.type) {
          case "linear":
            const distanceBetweenPoints = Length.fromSheetUnits(
              sheet,
              distance(workingConstraint.pointA, workingConstraint.pointB),
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
                  transform: 'translate(-50%, -50%)',
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
                      newWorkingConstraints[index] = { ...newWorkingConstraints[index], constrainedLength: value };
                      return newWorkingConstraints;
                    });
                  }}
                  placeholder={`${round(distanceBetweenPoints, 2)}`}
                  onTabPress={() => {
                    // When tab is pressed, focus the next constraint input (wrapping around at end)
                    let nextIndex = (index + 1) % workingConstraints.length;
                    constraintLengthInputsRef.current.get(nextIndex)?.focus();
                  }}
                  defaultUnit={sheet.defaultUnit}
                />
              </div>
            );
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
