import { FederatedPointerEvent } from 'pixi.js';
import { PolygonSegment } from '@/lib/geometry';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { getCurveControlPointHandleTexture } from '@/lib/textures';
import { SheetPosition } from '@/lib/viewport/types';

type CurveControlPointHandlesSpritesProps = {
  segments: Array<PolygonSegment>;
  scale: number;
  onControlPointerDown?: (
    event: FederatedPointerEvent,
    segmentIndex: number,
    pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB',
  ) => void;
  isDragging?: boolean;
};

export const CurveControlPointHandlesSprites: React.FunctionComponent<
  CurveControlPointHandlesSpritesProps
> = ({ segments, scale, onControlPointerDown, isDragging }) => {
  const spriteScale = 1 / scale;
  const controlPointInfos: Array<{
    point: SheetPosition;
    segmentIndex: number;
    pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB';
  }> = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'arc-quadratic') {
      controlPointInfos.push({
        point: seg.controlPoint,
        segmentIndex: i,
        pointKey: 'controlPoint',
      });
    } else if (seg.type === 'arc-cubic') {
      controlPointInfos.push({
        point: seg.controlPointA,
        segmentIndex: i,
        pointKey: 'controlPointA',
      });
      controlPointInfos.push({
        point: seg.controlPointB,
        segmentIndex: i,
        pointKey: 'controlPointB',
      });
    }
  }

  if (controlPointInfos.length === 0) {
    return null;
  }

  const effectiveEventMode = isDragging ? 'none' : onControlPointerDown ? 'static' : 'none';
  const effectiveCursor = isDragging ? 'default' : onControlPointerDown ? 'pointer' : 'default';

  return (
    <>
      {controlPointInfos.map((info, index) => (
        <pixiSprite
          key={index}
          texture={getCurveControlPointHandleTexture()}
          x={info.point.x * SHEET_UNITS_TO_PIXELS}
          y={info.point.y * SHEET_UNITS_TO_PIXELS}
          anchor={0.5}
          scale={spriteScale}
          eventMode={effectiveEventMode}
          cursor={effectiveCursor}
          {...(onControlPointerDown && !isDragging
            ? {
                onPointerDown: (e: FederatedPointerEvent) => {
                  onControlPointerDown(e, info.segmentIndex, info.pointKey);
                },
              }
            : {})}
        />
      ))}
    </>
  );
};
