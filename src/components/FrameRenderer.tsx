'use client';

import { useCallback, useEffect, useState } from 'react';
import FrameIndicator from '@/app/components/FrameIndicator';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { Entity, FrameComponent } from '@/lib/entity';
import { RendererLayers, SingleLayers } from '@/lib/renderer';
import { ScreenPosition } from '@/lib/viewport/types';
import { FederatedPointerEvent } from 'pixi.js';

const FrameOverlay: React.FunctionComponent = () => {
  const { geometryStore, viewportScale, toolManager, viewportControls } = useViewportContext();

  const selectedIds = useSelectionManagerSelectedIds();

  const [frames, setFrames] = useState<Array<Entity<FrameComponent>>>([]);
  const rebuildFrames = useCallback(() => {
    setFrames(geometryStore.listWithComponent(FrameComponent));
  }, [geometryStore]);
  useEffect(() => {
    rebuildFrames();
    geometryStore.on('geometryAdded', rebuildFrames);
    geometryStore.on('geometryUpdated', rebuildFrames);
    geometryStore.on('geometryDeleted', rebuildFrames);
    return () => {
      geometryStore.off('geometryAdded', rebuildFrames);
      geometryStore.off('geometryUpdated', rebuildFrames);
      geometryStore.off('geometryDeleted', rebuildFrames);
    };
  }, [geometryStore, rebuildFrames]);

  const handleFillPointerDown = useCallback(
    (e: FederatedPointerEvent, frameId: Entity['id']) => {
      if (!viewportControls) {
        return;
      }
      toolManager.getActiveTool().handleFrameFillPointerDown(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        frameId,
      );
    },
    [toolManager, viewportControls],
  );

  return (
    <>
      {frames.map((frame) => {
        // TODO: make add in shadowsFrameId checks in here for pattern grid filters?

        const isSelected = selectedIds.includes(frame.id);
        const frameData = FrameComponent.get(frame);
        return (
          <FrameIndicator
            key={frame.id}
            upperLeft={frameData.upperLeft}
            lowerRight={frameData.lowerRight}
            viewportScale={viewportScale}
            lineWidthPx={isSelected ? 2 : undefined}
            onPointerDown={isSelected ? (e) => handleFillPointerDown(e, frame.id) : undefined}
          />
        );
      })}
    </>
  );
};

/** Renders all frames currently on the sheet. */
export const FrameLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <FrameOverlay />,
};
