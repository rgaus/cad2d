import { FederatedPointerEvent, Graphics } from 'pixi.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { GearGeneratorAction, GearGeneratorState } from '@/lib/actions/GearGeneratorAction';
import { DragListener, createDragListener } from '@/lib/drag/create-drag-listener';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { applySnapping } from '@/lib/snapping';
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
  const { toolManager, viewportControls, viewportScale } = useViewportContext();
  const [state, setState] = useState<GearGeneratorState>(() => action.getState());
  const dragListenerRef = useRef<DragListener | null>(null);
  const escapeCleanupRef = useRef<(() => void) | null>(null);

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
      escapeCleanupRef.current?.();
      escapeCleanupRef.current = null;
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

      const removeEscapeListener = () => {
        escapeCleanupRef.current?.();
        escapeCleanupRef.current = null;
      };

      const onEscape = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== 'Escape') {
          return;
        }
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        dragListenerRef.current?.destroy();
      };
      window.addEventListener('keydown', onEscape, true);
      escapeCleanupRef.current = () => {
        window.removeEventListener('keydown', onEscape, true);
      };

      action.setPreviewDragging(true);

      dragListenerRef.current?.destroy();
      dragListenerRef.current = createDragListener({
        viewportControls,
        onMove: (screenPos) => {
          const liveViewport = viewportControls.getState().viewport;
          const sheet = screenPos.toWorld(liveViewport).toSheet();
          const rawCenter = new SheetPosition(sheet.x + grabOffset.x, sheet.y + grabOffset.y);
          const snappedCenter = applySnapping(rawCenter, {
            primaryGridSize: toolManager.snappingOptions.primaryGridSize,
            secondaryGridSize: toolManager.snappingOptions.secondaryGridSize,
            ctrlHeld: toolManager.getCtrlHeld(),
            superHeld: false,
            viewportScale: liveViewport.scale,
          });
          action.setCenter(snappedCenter);
        },
        onCommit: () => {
          const finalCenter = action.getState().params.center;
          action.commitCenterMove(originalCenter, finalCenter);
          action.setPreviewDragging(false);
          removeEscapeListener();
          dragListenerRef.current = null;
        },
        onCancel: () => {
          action.setCenter(originalCenter);
          action.setPreviewDragging(false);
          removeEscapeListener();
          dragListenerRef.current = null;
        },
      });
    },
    [action, toolManager, viewportControls],
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
            fillColor={state.params.fillColor}
            stroke={PREVIEW_STROKE_COLOR}
            strokeWidth={2}
            viewportScale={viewportScale}
            eventMode="none"
          />
        ))}

      <pixiGraphics draw={drawCenterHandle} eventMode="none" />

      <pixiGraphics
        draw={drawGearHitArea}
        eventMode="static"
        cursor="move"
        onPointerDown={startDrag}
        onPointerEnter={() => action.setPreviewHovered(true)}
        onPointerLeave={() => action.setPreviewHovered(false)}
      />
    </>
  );
};
