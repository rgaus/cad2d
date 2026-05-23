import { useCallback, useEffect, useState } from "react";
import { Graphics } from "pixi.js";
import { useViewportContext } from "@/contexts/viewport-context";
import { FaceId, HalfEdge } from "@/lib/dcel";
import { addVec2, angleToNormVec2, angleVec2, normVec2, perpVec2, scaleVec2, subVec2 } from "@/lib/math";
import { SingleLayers } from "@/lib/renderer";
import { WorldPosition } from "@/lib/viewport/types";

const FACE_COLORS = [0xee0000, 0x00ee00, 0x0000ee, 0xeeee00, 0x00eeee, 0xee00ee];

const HALF_EDGE_LINE_WIDTH_PX = 1.5;

const HALF_EDGE_PERPENDICULAR_OFFSET_PX = 4;
const HALF_EDGE_INLINE_OFFSET_PX = 12;
const HALF_EDGE_ARROW_LENGTH_PX = 16;
const HALF_EDGE_ORIGIN_RADIUS_PX = 4;

const DCELDebugRendererOverlays: React.FunctionComponent = () => {
  const { geometryStore, viewportScale } = useViewportContext();

  const [halfEdges, setHalfEdges] = useState<Array<HalfEdge>>([]);
  useEffect(() => {
    geometryStore.dcelIndex.dcel.on('handleHalfEdgesChange', setHalfEdges);
    return () => {
      geometryStore.dcelIndex.dcel.off('handleHalfEdgesChange', setHalfEdges);
    };
  }, [geometryStore]);

  const draw = useCallback((graphics: Graphics) => {
    graphics.clear();

    let faceColorCounter = -1;
    let faceColors = new Map<FaceId, number>();
    const getFaceColor = (faceId?: FaceId | null) => {
      if (typeof faceId !== 'string') {
        return 0x000000;
      }
      const existing = faceColors.get(faceId);
      if (typeof existing === 'number') {
        return existing;
      }
      faceColorCounter += 1;
      const color = FACE_COLORS[faceColorCounter % FACE_COLORS.length]
      faceColors.set(faceId, color);
      return color;
    };

    const halfEdgeIdsAlreadyRendered = new Set();
    for (const halfEdge of halfEdges) {
      if (halfEdgeIdsAlreadyRendered.has(halfEdge.id)) {
        continue;
      }

      const origin = geometryStore.dcelIndex.dcel.getPosition(halfEdge.originId);

      const twin = halfEdge.twinId ? geometryStore.dcelIndex.dcel.getHalfEdge(halfEdge.twinId) : null;
      const twinOrigin = twin ? geometryStore.dcelIndex.dcel.getPosition(twin.originId) : null;

      if (!origin || !twin || !twinOrigin) {
        continue;
      }
      const originWorld = origin.toWorld();
      const twinOriginWorld = twinOrigin.toWorld();

      const halfEdgeNormal = normVec2(subVec2(originWorld, twinOriginWorld));

      // Offset the half edge one way, and the twin edge the other way so they can be more easily
      // visually distinguished.
      const offsetVec = scaleVec2(perpVec2(halfEdgeNormal), HALF_EDGE_PERPENDICULAR_OFFSET_PX / viewportScale);

      const halfEdgeStart = subVec2(
        subVec2(originWorld, offsetVec),
        scaleVec2(halfEdgeNormal, HALF_EDGE_INLINE_OFFSET_PX / viewportScale),
      );
      const halfEdgeEnd = subVec2(
        subVec2(twinOriginWorld, offsetVec),
        scaleVec2(halfEdgeNormal, -1 * HALF_EDGE_INLINE_OFFSET_PX / viewportScale),
      );

      const halfEdgeAngle = angleVec2(halfEdgeNormal);
      const halfEdgeArrowEnd = addVec2(
        halfEdgeEnd,
        scaleVec2(
          angleToNormVec2(halfEdgeAngle - 90 + 45 + 22.5, WorldPosition),
          HALF_EDGE_ARROW_LENGTH_PX / viewportScale,
        ),
      );

      graphics.setStrokeStyle({ color: getFaceColor(halfEdge.faceIds[0]), width: HALF_EDGE_LINE_WIDTH_PX / viewportScale });

      graphics.circle(originWorld.x, originWorld.y, HALF_EDGE_ORIGIN_RADIUS_PX / viewportScale);

      graphics.moveTo(halfEdgeStart.x, halfEdgeStart.y);
      graphics.lineTo(halfEdgeEnd.x, halfEdgeEnd.y);
      graphics.lineTo(halfEdgeArrowEnd.x, halfEdgeArrowEnd.y);

      graphics.stroke();

      halfEdgeIdsAlreadyRendered.add(halfEdge.id);

      const twinNormal = normVec2(subVec2(twinOriginWorld, originWorld));

      const twinStart = subVec2(
        addVec2(twinOriginWorld, offsetVec),
        scaleVec2(twinNormal, HALF_EDGE_INLINE_OFFSET_PX / viewportScale),
      );
      const twinEnd = subVec2(
        addVec2(originWorld, offsetVec),
        scaleVec2(twinNormal, -1 * HALF_EDGE_INLINE_OFFSET_PX / viewportScale),
      );

      const twinArrowEnd = addVec2(
        twinEnd,
        scaleVec2(
          angleToNormVec2(halfEdgeAngle + 90 + 45 + 22.5, WorldPosition),
          HALF_EDGE_ARROW_LENGTH_PX / viewportScale,
        ),
      );

      graphics.setStrokeStyle({ color: getFaceColor(twin.faceIds[0]), width: HALF_EDGE_LINE_WIDTH_PX / viewportScale });

      graphics.moveTo(twinStart.x, twinStart.y);
      graphics.lineTo(twinEnd.x, twinEnd.y);
      graphics.lineTo(twinArrowEnd.x, twinArrowEnd.y);

      graphics.stroke();

      halfEdgeIdsAlreadyRendered.add(twin.id);
    }
  }, [halfEdges, geometryStore.dcelIndex.dcel, viewportScale]);

  return (
    <pixiContainer>
      <pixiGraphics draw={draw} />
    </pixiContainer>
  );
};

export const DCELDebugRenderer: SingleLayers<React.ReactNode> = {
  Overlays: <DCELDebugRendererOverlays />,
};
