import { FederatedPointerEvent, Graphics } from 'pixi.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { GearGeneratorAction, GearGeneratorState } from '@/lib/actions/GearGeneratorAction';
import { DragListener, createDragListener } from '@/lib/drag/create-drag-listener';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { ScreenPosition, SheetPosition } from '@/lib/viewport/types';
import { GeometryShapeRenderer } from './GeometryRenderer';

const PREVIEW_STROKE_COLOR = 0x2f80ed;
const CENTER_HANDLE_RADIUS_PX = 7;

type GearPreviewRendererProps = {
  action: GearGeneratorAction;
};

/** Renders the live gear preview and lets the user drag it around the sheet. */
export const GearPreviewRenderer: React.FunctionComponent<GearPreviewRendererProps> = ({
  action,
}) => {
  const { viewportControls, viewportScale } = useViewportContext();
  const [state, setState] = useState<GearGeneratorState>(() => action.getState());
  const dragListenerRef = useRef<DragListener | null>(null);

  useEffect(() => {
    const handleStateChange = (nextState: GearGeneratorState) => {
      setState(nextState);
    };
    action.on('stateChange', handleStateChange);
    return () => {
      action.off('stateChange', handleStateChange);
    };
  }, [action]);

  useEffect(() => {
    return () => {
      dragListenerRef.current?.destroy();
      dragListenerRef.current = null;
    };
  }, []);

  const startDrag = useCallback(
    (event: FederatedPointerEvent) => {
      if (!viewportControls) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (event.nativeEvent instanceof Event) {
        event.nativeEvent.stopPropagation();
      }

      const viewport = viewportControls.getState().viewport;
      const pointer = new ScreenPosition(event.clientX, event.clientY).toWorld(viewport).toSheet();
      const originalCenter = action.getState().params.center;
      const grabOffset = new SheetPosition(
        originalCenter.x - pointer.x,
        originalCenter.y - pointer.y,
      );

      dragListenerRef.current?.destroy();
      dragListenerRef.current = createDragListener({
        viewportControls,
        onMove: (screenPos) => {
          const liveViewport = viewportControls.getState().viewport;
          const sheet = screenPos.toWorld(liveViewport).toSheet();
          action.setCenter(new SheetPosition(sheet.x + grabOffset.x, sheet.y + grabOffset.y));
        },
        onCommit: () => {
          dragListenerRef.current = null;
        },
        onCancel: () => {
          action.setCenter(originalCenter);
          dragListenerRef.current = null;
        },
      });
    },
    [action, viewportControls],
  );

  if (!state.panelVisible || state.preview === null) {
    return null;
  }

  const preview = state.preview;
  const center = state.params.center;
  const centerX = center.x * SHEET_UNITS_TO_PIXELS;
  const centerY = center.y * SHEET_UNITS_TO_PIXELS;
  const handleRadius = CENTER_HANDLE_RADIUS_PX / viewportScale;

  const drawCenterHandle = (graphics: Graphics) => {
    graphics.clear();
    graphics.setFillStyle({ color: PREVIEW_STROKE_COLOR, alpha: 0.001 });
    graphics.circle(centerX, centerY, handleRadius * 1.5);
    graphics.fill();
    graphics.setStrokeStyle({ color: PREVIEW_STROKE_COLOR, width: 2 / viewportScale });
    graphics.circle(centerX, centerY, handleRadius);
    graphics.stroke();
    graphics.moveTo(centerX - handleRadius, centerY);
    graphics.lineTo(centerX + handleRadius, centerY);
    graphics.moveTo(centerX, centerY - handleRadius);
    graphics.lineTo(centerX, centerY + handleRadius);
    graphics.stroke();
  };

  const drawGearHitArea = (graphics: Graphics) => {
    graphics.clear();
    for (const shape of preview.shapes) {
      if (shape.shape !== 'polygon' || shape.points.length < 2) {
        continue;
      }
      graphics.setFillStyle({ color: PREVIEW_STROKE_COLOR, alpha: 0.001 });
      graphics.poly(
        shape.points.flatMap((segment) => [
          segment.point.x * SHEET_UNITS_TO_PIXELS,
          segment.point.y * SHEET_UNITS_TO_PIXELS,
        ]),
      );
      graphics.fill();
    }
  };

  return (
    <>
      {preview.shapes
        .filter((shape) => shape.shape === 'polygon')
        .map((shape) => (
          <GeometryShapeRenderer
            key={shape.key}
            type="polygon"
            segments={shape.points}
            closed={shape.closed}
            fillColor={null}
            stroke={PREVIEW_STROKE_COLOR}
            strokeWidth={2}
            viewportScale={viewportScale}
            eventMode="none"
          />
        ))}

      <pixiGraphics
        draw={drawGearHitArea}
        eventMode="static"
        cursor="move"
        onPointerDown={startDrag}
      />

      <pixiGraphics
        draw={drawCenterHandle}
        eventMode="static"
        cursor="move"
        onPointerDown={startDrag}
      />
    </>
  );
};
