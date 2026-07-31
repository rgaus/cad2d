'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import FrameIndicator from '@/app/components/FrameIndicator';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { Entity, FrameComponent } from '@/lib/entity';
import { RendererLayers, SingleLayers } from '@/lib/renderer';
import { SELECTION_COLOR } from '@/lib/textures';

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

  const handleFrameEdgeResizerPointerDown = useCallback(
    (filterId: Entity<FrameComponent>['id'], edge: 'top' | 'bottom' | 'left' | 'right') => {
      if (!viewportControls) {
        return;
      }
      toolManager.getActiveTool().handleFrameResizePointerDown(viewportControls, filterId, {
        type: 'edge',
        edge,
      });
    },
    [toolManager, viewportControls],
  );

  const handleFrameCornerHandlePointerDown = useCallback(
    (
      filterId: Entity<FrameComponent>['id'],
      corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
    ) => {
      if (!viewportControls) {
        return;
      }
      toolManager.getActiveTool().handleFrameResizePointerDown(viewportControls, filterId, {
        type: 'corner',
        corner,
      });
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
          <Fragment key={frame.id}>
            <FrameIndicator
              upperLeft={frameData.upperLeft}
              lowerRight={frameData.lowerRight}
              viewportScale={viewportScale}
              lineWidthPx={isSelected ? 2 : undefined}
              color={isSelected ? SELECTION_COLOR : undefined}
              onEdgeResizerPointerDown={
                isSelected
                  ? (edge) => handleFrameEdgeResizerPointerDown(frame.id, edge)
                  : undefined
              }
              onCornerHandlePointerDown={
                isSelected
                  ? (corner) =>
                      handleFrameCornerHandlePointerDown(frame.id, corner)
                  : undefined
              }
            />
          </Fragment>
        );
      })}
    </>
  );
};

/** Renders all frames currently on the sheet. */
export const FrameLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <FrameOverlay />,
};
