"use client";

import { useEffect, useRef, useState } from "react";
import { type Constraint } from "@/lib/geometry/types";
import DimensionLineConstrait from "@/app/components/DimensionLineConstrait";
import { useViewportContext } from "@/contexts/viewport-context";
import { RendererLayers, SingleLayers } from "@/lib/renderer";
import { WorkingConstraint } from "@/lib/tools/types";
import { midPoint } from "@/lib/math";
import LengthInput, { LengthInputHandle } from "@/app/components/LengthInput";
// import { useWorkingConstraints } from "@/hooks/useWorkingConstraints";

// /** Render the currently being drawn constraint, or nothing is no constraint is being drawn. */
// export const WorkingConstraintRenderer: React.FunctionComponent = () => {
//   const { sheet, viewportScale } = useViewportContext();
//   const workingConstraint = useWorkingConstraint();

//   const firstPoint = workingConstraint?.firstPoint ?? null;
//   const previewPoint = workingConstraint?.previewPoint ?? null;

//   const center = firstPoint !== null && previewPoint !== null
//     ? (workingConstraint?.isCenterMode
//       ? firstPoint
//       : new SheetPosition(
//           (Math.min(firstPoint.x, previewPoint.x) + Math.max(firstPoint.x, previewPoint.x)) / 2,
//           (Math.min(firstPoint.y, previewPoint.y) + Math.max(firstPoint.y, previewPoint.y)) / 2,
//         ))
//     : new SheetPosition(0, 0);

//   const radiusX = firstPoint !== null && previewPoint !== null
//     ? (workingConstraint?.isCenterMode
//       ? Math.abs(previewPoint.x - firstPoint.x)
//       : (Math.max(firstPoint.x, previewPoint.x) - Math.min(firstPoint.x, previewPoint.x)) / 2)
//     : 0;

//   const radiusY = firstPoint !== null && previewPoint !== null
//     ? (workingConstraint?.isCenterMode
//       ? Math.abs(previewPoint.y - firstPoint.y)
//       : (Math.max(firstPoint.y, previewPoint.y) - Math.min(firstPoint.y, previewPoint.y)) / 2)
//     : 0;

//   const centerX = center.x * SHEET_UNITS_TO_PIXELS;
//   const centerY = center.y * SHEET_UNITS_TO_PIXELS;
//   const radiusXPixels = radiusX * SHEET_UNITS_TO_PIXELS;
//   const radiusYPixels = radiusY * SHEET_UNITS_TO_PIXELS;

//   const drawWorkingConstraint = useCallback((graphics: Graphics) => {
//     graphics.clear();
//     graphics.setStrokeStyle({ color: 0x000000, width: 1 / viewportScale });
//     graphics.constraint(centerX, centerY, radiusXPixels, radiusYPixels);
//     graphics.stroke();
//   }, [viewportScale, centerX, centerY, radiusXPixels, radiusYPixels]);

//   const radiusPointRight = new SheetPosition(center.x + radiusX, center.y);
//   const radiusPointTop = new SheetPosition(center.x, center.y - radiusY);

//   if (firstPoint === null || previewPoint === null) {
//     return null;
//   }

//   return (
//     <pixiContainer>
//       <pixiGraphics draw={drawWorkingConstraint} />
//       <DimensionLineConstrait
//         key="dim-rx"
//         pointA={center}
//         pointB={radiusPointRight}
//         viewportScale={viewportScale}
//         sheet={sheet}
//         offsetPx={16}
//       />
//       <DimensionLineConstrait
//         key="dim-ry"
//         pointA={center}
//         pointB={radiusPointTop}
//         viewportScale={viewportScale}
//         sheet={sheet}
//         offsetPx={16}
//       />
//     </pixiContainer>
//   );
// };

// /** Renders the "working constraint" - the constraint currently being created by the user when using the
//  * constraint tool. */
// export const WorkingConstraintLayers: SingleLayers<React.ReactNode> = {
//   [RendererLayers.Overlays]: <WorkingConstraintRenderer />,
// };

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
  const { geometryStore, viewportControls } = useViewportContext();

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
  const firstLengthInputRef = useRef<LengthInputHandle | null>(null);
  const workingConstraintsEmpty = workingConstraints.length === 0;
  useEffect(() => {
    if (workingConstraintsEmpty) {
      return;
    }

    setTimeout(() => {
      firstLengthInputRef.current?.focus();
      firstLengthInputRef.current?.select();
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
                <LengthInput
                  ref={(r) => {
                    if (index === 0) {
                      firstLengthInputRef.current = r;
                    }
                  }}
                  value={workingConstraint.constrainedLength}
                  onChange={(value) => {
                    geometryStore.setWorkingConstraints((old) => [{ ...old[0], constrainedLength: value }]);
                  }}
                  variant="constraint"
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
