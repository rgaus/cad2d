import { Graphics, Texture } from 'pixi.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { FaceId, HalfEdge, HalfEdgeId } from '@/lib/dcel';
import {
  addVec2,
  angleToNormVec2,
  angleVec2,
  midPoint,
  normVec2,
  perpVec2,
  scaleVec2,
  subVec2,
} from '@/lib/math';
import { SingleLayers } from '@/lib/renderer';
import { getDimensionTextTexture } from '@/lib/viewport/dimensionUtils';
import { WorldPosition } from '@/lib/viewport/types';

const FACE_COLORS = [0xee0000, 0x00ee00, 0x0000ee, 0xeeee00, 0x00eeee, 0xee00ee];
const FACE_TEXT_COLORS = [0x000000, 0xffffff, 0xffffff, 0x000000, 0x000000, 0x000000];

const _faceColorMap = new Map<FaceId, number>();
let _faceColorCounter = -1;
function getFaceColor(faceId?: FaceId | null): number {
  if (typeof faceId !== 'string') {
    return 0x000000;
  }
  let color = _faceColorMap.get(faceId);
  if (typeof color === 'undefined') {
    _faceColorCounter += 1;
    color = FACE_COLORS[_faceColorCounter % FACE_COLORS.length];
    _faceColorMap.set(faceId, color);
  }
  return color;
}

function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

const HALF_EDGE_LINE_WIDTH_PX = 1.5;

const HALF_EDGE_PERPENDICULAR_OFFSET_PX = 4;
const HALF_EDGE_INLINE_OFFSET_PX = 12;
const HALF_EDGE_ARROW_LENGTH_PX = 16;
const HALF_EDGE_ORIGIN_RADIUS_PX = 4;
const HALF_EDGE_LABEL_OFFSET_PX = 12;

const DCELDebugRendererOverlays: React.FunctionComponent = () => {
  const { geometryStore, viewportScale, sheet } = useViewportContext();

  const [halfEdges, setHalfEdges] = useState<Array<HalfEdge>>([]);
  useEffect(() => {
    geometryStore.dcelIndex.dcel.on('handleHalfEdgesChange', setHalfEdges);
    return () => {
      geometryStore.dcelIndex.dcel.off('handleHalfEdgesChange', setHalfEdges);
    };
  }, [geometryStore]);

  const [enabled, setEnabled] = useState(sheet.dcelDebugView);
  useEffect(() => {
    sheet.on('dcelDebugViewChange', setEnabled);
    return () => {
      sheet.off('dcelDebugViewChange', setEnabled);
    };
  }, [sheet]);

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      const halfEdgeIdsAlreadyRendered = new Set();
      for (const halfEdge of halfEdges) {
        if (halfEdgeIdsAlreadyRendered.has(halfEdge.id)) {
          continue;
        }

        const origin = geometryStore.dcelIndex.dcel.getPosition(halfEdge.originId);

        const twin = halfEdge.twinId
          ? geometryStore.dcelIndex.dcel.getHalfEdge(halfEdge.twinId)
          : null;
        const twinOrigin = twin ? geometryStore.dcelIndex.dcel.getPosition(twin.originId) : null;

        if (!origin || !twin || !twinOrigin) {
          continue;
        }
        const originWorld = origin.toWorld();
        const twinOriginWorld = twinOrigin.toWorld();

        const halfEdgeNormal = normVec2(subVec2(originWorld, twinOriginWorld));

        // Offset the half edge one way, and the twin edge the other way so they can be more easily
        // visually distinguished.
        const offsetVec = scaleVec2(
          perpVec2(halfEdgeNormal),
          HALF_EDGE_PERPENDICULAR_OFFSET_PX / viewportScale,
        );

        const halfEdgeStart = subVec2(
          subVec2(originWorld, offsetVec),
          scaleVec2(halfEdgeNormal, HALF_EDGE_INLINE_OFFSET_PX / viewportScale),
        );
        const halfEdgeEnd = subVec2(
          subVec2(twinOriginWorld, offsetVec),
          scaleVec2(halfEdgeNormal, (-1 * HALF_EDGE_INLINE_OFFSET_PX) / viewportScale),
        );

        const halfEdgeAngle = angleVec2(halfEdgeNormal);

        // Look up curve context for this undirected edge
        const edgeKey = geometryStore.dcelIndex.dcel.getEdgeKey(halfEdge.originId, twin.originId);
        const curveCtx = geometryStore.dcelIndex.getCurveContext(halfEdge.originId, twin.originId);

        graphics.setStrokeStyle({
          color: getFaceColor(halfEdge.faceIds[0]),
          width: HALF_EDGE_LINE_WIDTH_PX / viewportScale,
        });

        graphics.circle(originWorld.x, originWorld.y, HALF_EDGE_ORIGIN_RADIUS_PX / viewportScale);

        graphics.moveTo(halfEdgeStart.x, halfEdgeStart.y);
        if (curveCtx) {
          if (curveCtx.type === 'quadratic') {
            const cp = subVec2(curveCtx.controlPoint.toWorld(), offsetVec);
            graphics.quadraticCurveTo(cp.x, cp.y, halfEdgeEnd.x, halfEdgeEnd.y);
          } else {
            const cpA = subVec2(curveCtx.controlPointA.toWorld(), offsetVec);
            const cpB = subVec2(curveCtx.controlPointB.toWorld(), offsetVec);
            graphics.bezierCurveTo(cpA.x, cpA.y, cpB.x, cpB.y, halfEdgeEnd.x, halfEdgeEnd.y);
          }
        } else {
          graphics.lineTo(halfEdgeEnd.x, halfEdgeEnd.y);
        }
        graphics.lineTo(
          addVec2(
            halfEdgeEnd,
            scaleVec2(
              angleToNormVec2(halfEdgeAngle - 90 + 45 + 22.5, WorldPosition),
              HALF_EDGE_ARROW_LENGTH_PX / viewportScale,
            ),
          ).x,
          addVec2(
            halfEdgeEnd,
            scaleVec2(
              angleToNormVec2(halfEdgeAngle - 90 + 45 + 22.5, WorldPosition),
              HALF_EDGE_ARROW_LENGTH_PX / viewportScale,
            ),
          ).y,
        );

        graphics.stroke();

        halfEdgeIdsAlreadyRendered.add(halfEdge.id);

        const twinNormal = normVec2(subVec2(twinOriginWorld, originWorld));

        const twinStart = subVec2(
          addVec2(twinOriginWorld, offsetVec),
          scaleVec2(twinNormal, HALF_EDGE_INLINE_OFFSET_PX / viewportScale),
        );
        const twinEnd = subVec2(
          addVec2(originWorld, offsetVec),
          scaleVec2(twinNormal, (-1 * HALF_EDGE_INLINE_OFFSET_PX) / viewportScale),
        );

        graphics.setStrokeStyle({
          color: getFaceColor(twin.faceIds[0]),
          width: HALF_EDGE_LINE_WIDTH_PX / viewportScale,
        });

        graphics.moveTo(twinStart.x, twinStart.y);
        if (curveCtx) {
          if (curveCtx.type === 'quadratic') {
            // Reverse: twin goes opposite direction, but the quadratic
            // control point is the same (just traversed backwards).
            const cp = addVec2(curveCtx.controlPoint.toWorld(), offsetVec);
            graphics.quadraticCurveTo(cp.x, cp.y, twinEnd.x, twinEnd.y);
          } else {
            // Reverse the control points for the opposite direction
            const cpA = addVec2(curveCtx.controlPointB.toWorld(), offsetVec);
            const cpB = addVec2(curveCtx.controlPointA.toWorld(), offsetVec);
            graphics.bezierCurveTo(cpA.x, cpA.y, cpB.x, cpB.y, twinEnd.x, twinEnd.y);
          }
        } else {
          graphics.lineTo(twinEnd.x, twinEnd.y);
        }
        graphics.lineTo(
          addVec2(
            twinEnd,
            scaleVec2(
              angleToNormVec2(halfEdgeAngle + 90 + 45 + 22.5, WorldPosition),
              HALF_EDGE_ARROW_LENGTH_PX / viewportScale,
            ),
          ).x,
          addVec2(
            twinEnd,
            scaleVec2(
              angleToNormVec2(halfEdgeAngle + 90 + 45 + 22.5, WorldPosition),
              HALF_EDGE_ARROW_LENGTH_PX / viewportScale,
            ),
          ).y,
        );

        graphics.stroke();

        halfEdgeIdsAlreadyRendered.add(twin.id);
      }
    },
    [halfEdges, geometryStore.dcelIndex.dcel, viewportScale],
  );

  const labels = useMemo<Array<{ texture: Texture; x: number; y: number; anchorY: number }>>(() => {
    const result: Array<{ texture: Texture; x: number; y: number; anchorY: number }> = [];
    const halfEdgeIdsAlreadyRendered = new Set<HalfEdgeId>();

    for (const halfEdge of halfEdges) {
      if (halfEdgeIdsAlreadyRendered.has(halfEdge.id)) {
        continue;
      }

      const origin = geometryStore.dcelIndex.dcel.getPosition(halfEdge.originId);
      const twin = halfEdge.twinId
        ? geometryStore.dcelIndex.dcel.getHalfEdge(halfEdge.twinId)
        : null;
      const twinOrigin = twin ? geometryStore.dcelIndex.dcel.getPosition(twin.originId) : null;

      if (!origin || !twin || !twinOrigin) {
        continue;
      }
      const originWorld = origin.toWorld();
      const twinOriginWorld = twinOrigin.toWorld();

      const mid = midPoint(originWorld, twinOriginWorld);

      // Half-edge label: +labelOffset (opposite its visual line at -visualOffset)
      const faceColor = getFaceColor(halfEdge.faceIds[0]);
      const halfEdgeBgColor = colorToHex(faceColor);
      result.push({
        texture: getDimensionTextTexture(
          `id=${halfEdge.id} originId=${halfEdge.originId}`,
          halfEdgeBgColor,
          colorToHex(FACE_TEXT_COLORS[FACE_COLORS.indexOf(faceColor)] ?? 0xffffff),
        ),
        x: mid.x,
        y: mid.y,
        anchorY: 1,
      });
      halfEdgeIdsAlreadyRendered.add(halfEdge.id);

      // Twin label: -labelOffset (opposite its visual line at +visualOffset)
      const twinFaceColor = getFaceColor(twin.faceIds[0]);
      const twinBgColor = colorToHex(twinFaceColor);
      result.push({
        texture: getDimensionTextTexture(
          `id=${twin.id} originId=${twin.originId}`,
          twinBgColor,
          colorToHex(FACE_TEXT_COLORS[FACE_COLORS.indexOf(twinFaceColor)] ?? 0xffffff),
        ),
        x: mid.x,
        y: mid.y,
        anchorY: 0,
      });
      halfEdgeIdsAlreadyRendered.add(twin.id);
    }

    return result;
  }, [halfEdges, geometryStore.dcelIndex.dcel, viewportScale]);

  if (!enabled) {
    return null;
  }

  const spriteScale = 1 / viewportScale;

  return (
    <pixiContainer>
      <pixiGraphics draw={draw} />
      {labels.map((label) => (
        <pixiSprite
          key={`${label.x},${label.y},${label.anchorY}`}
          texture={label.texture}
          x={label.x}
          y={label.y}
          anchor={{ x: 0.5, y: label.anchorY }}
          scale={spriteScale}
        />
      ))}
    </pixiContainer>
  );
};

export const DCELDebugRenderer: SingleLayers<React.ReactNode> = {
  Overlays: <DCELDebugRendererOverlays />,
};
