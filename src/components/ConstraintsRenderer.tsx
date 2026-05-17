"use client";

import { useEffect, useState } from "react";
import { type Constraint } from "@/lib/geometry/types";
import DimensionLineConstrait from "@/app/components/DimensionLineConstrait";
import { useViewportContext } from "@/contexts/viewport-context";
import { RendererLayers, SingleLayers } from "@/lib/renderer";
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
    // activeTool,
    // viewportControls,
    geometryStore,
    viewportScale,
    sheet,
  } = useViewportContext();

  const [constraints, setConstraints] = useState<Array<Constraint>>([]);
  useEffect(() => {
    geometryStore.on('constraintsChanged', setConstraints);
    return () => {
      geometryStore.off('constraintsChanged', setConstraints);
    };
  }, [geometryStore]);

  // const handlePointDrag = useCallback((constraint: Constraint, point: 'pointA' | 'pointB') => {
  //   if (activeTool.type !== "select") {
  //     return;
  //   }
  //   if (!viewportControls) {
  //     return;
  //   }
  //   // activeTool.onConstraintCornerHandlePointerDown?.(
  //   //   viewportControls,
  //   //   constraint.id,
  //   //   corner,
  //   // );
  // }, [activeTool, viewportControls]);

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
    </>
  );
};

/** Renders all constraints currently on the sheet. */
export const ConstraintLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <ConstraintOverlay />,
};
