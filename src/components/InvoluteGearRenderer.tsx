import { FederatedPointerEvent } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { useWorkingInvoluteGear } from '@/hooks/useWorkingInvoluteGear';
import { Entity, FillColorComponent } from '@/lib/entity';
import {
  DEFAULT_GEAR_FILL_COLOR,
  InvoluteGearComponent,
  buildGearOutlinePoints,
} from '@/lib/entity/components/InvoluteGearComponent';
import type { InvoluteGear } from '@/lib/entity/involute-gear';
import { ListLayers, RendererLayers, SingleLayers } from '@/lib/renderer';
import {
  HIGHLIGHT_COLOR_FILL,
  HIGHLIGHT_COLOR_STROKE,
  HIGHLIGHT_STROKE_WIDTH,
} from '@/lib/textures';
import { ScreenPosition } from '@/lib/viewport/types';
import { GeometryShapeRenderer } from './GeometryRenderer';
import { useDraggingShapeState } from '@/hooks/useDraggingShapeState';

type InvoluteGearSolidProps = {
  gear: InvoluteGear;
};

const InvoluteGearSolid: React.FunctionComponent<InvoluteGearSolidProps> = ({ gear }) => {
  const { activeTool, viewportControls, viewportScale, highlightedGeometryId } =
    useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();
  const isSelected = selectedIds.includes(gear.id);
  const state = useDraggingShapeState();
  const isDragging = state?.type === "geometry-translation" && state.ids.includes(gear.id);

  let fillColor = FillColorComponent.getOptional(gear);
  let stroke = 0x000000;
  let strokeWidth = 1;
  const opacity = isDragging ? 0.75 : 1;
  if (highlightedGeometryId === gear.id) {
    fillColor = HIGHLIGHT_COLOR_FILL;
    stroke = HIGHLIGHT_COLOR_STROKE;
    strokeWidth = HIGHLIGHT_STROKE_WIDTH;
  }

  const onFillPointerDown = useCallback(
    (event: FederatedPointerEvent) => {
      if (!viewportControls) {
        return;
      }
      const shouldCancel = activeTool.handleGeometryFillPointerDown(
        new ScreenPosition(event.clientX, event.clientY),
        viewportControls,
        gear.id,
      );
      if (shouldCancel) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [activeTool, gear.id, viewportControls],
  );

  const renderShapes = useMemo(
    () => InvoluteGearComponent.getRenderShapes(gear as Entity<InvoluteGearComponent>),
    [gear],
  );

  return (
    <>
      {renderShapes.map((shape) =>
        shape.shape === 'polygon' ? (
          <GeometryShapeRenderer
            key={shape.key}
            type="polygon"
            segments={shape.points}
            closed={shape.closed}
            fillColor={fillColor}
            stroke={stroke}
            strokeWidth={strokeWidth}
            viewportScale={viewportScale}
            showHintStroke={isSelected && selectedIds.length > 1}
            eventMode="static"
            onFillPointerDown={onFillPointerDown}
            onFillPointerOver={() => activeTool.handleGeometryFillEnter(gear.id)}
            onFillPointerOut={() => activeTool.handleGeometryFillLeave(gear.id)}
            alpha={opacity}
          />
        ) : null,
      )}
    </>
  );
};

const WorkingInvoluteGearPreview: React.FunctionComponent = () => {
  const { geometryStore, viewportScale } = useViewportContext();
  const working = useWorkingInvoluteGear(geometryStore);
  if (!working) {
    return null;
  }

  const points = buildGearOutlinePoints(working.params, working.moduleSheetUnits, working.position);
  const segments = points.map((point) => ({ type: 'point' as const, point }));

  return (
    <pixiContainer alpha={0.5}>
      <GeometryShapeRenderer
        type="polygon"
        segments={segments}
        closed
        fillColor={DEFAULT_GEAR_FILL_COLOR}
        stroke={0x2f80ed}
        strokeWidth={2}
        viewportScale={viewportScale}
        eventMode="none"
      />
    </pixiContainer>
  );
};

export const InvoluteGearLayers: ListLayers<InvoluteGear, React.ReactNode> = {
  [RendererLayers.Solids]: (gear) => <InvoluteGearSolid gear={gear} />,
};

export const WorkingInvoluteGearLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <WorkingInvoluteGearPreview />,
};
