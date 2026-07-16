'use client';

import { Application, extend } from '@pixi/react';
import { Container, FederatedMouseEvent, Graphics, Sprite, Texture } from 'pixi.js';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConstraintLayers } from '@/components/ConstraintsRenderer';
import { DCELDebugRenderer } from '@/components/DCELDebugRenderer';
import { DatumLayers, WorkingDatumLayers } from '@/components/DatumRenderer';
import { EllipseLayers, WorkingEllipseLayers } from '@/components/EllipseRenderer';
import { FilterLayers } from '@/components/FilterRenderer';
import { HandleSprites } from '@/components/HandleSprites';
import { PolygonLayers, WorkingPolygonLayers } from '@/components/PolygonRenderer';
import { RectangleLayers, WorkingRectangleLayers } from '@/components/RectangleRenderer';
import { SelectionBoxOverlay } from '@/components/SelectionBoxOverlay';
import { SheetRenderer } from '@/components/SheetRenderer';
import { SnapsHintLayers } from '@/components/SnapHintsLayers';
import { ViewportContextData, ViewportContextProvider } from '@/contexts/viewport-context';
import { useDevicePixelRatio } from '@/hooks';
import { ActionsManager } from '@/lib/actions/ActionsManager';
import { PLATFORM_ALT_KEY_STRING, PLATFORM_SUPER_KEY_STRING } from '@/lib/detection';
import {
  type Datum,
  DatumComponent,
  type Ellipse,
  EllipseComponent,
  FillColorComponent,
  Geometry,
  type Id,
  LinkDimensionsComponent,
  PolygonComponent,
  type Rectangle,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/geometry';
import { KeyCombo } from '@/lib/index-mapper';
import {
  ListLayers,
  RENDERER_DOM_LAYER_ORDER,
  RENDERER_PIXI_LAYER_ORDER,
  RendererLayers,
  SingleLayers,
} from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS, type Sheet } from '@/lib/sheet/Sheet';
import { type KeyPointSnapInfo } from '@/lib/snapping';
import { IntersectionVertexHandleTexture, VertexHandleTexture } from '@/lib/textures';
import {
  BaseCornerGeometryReplacerTool,
  CornerState,
} from '@/lib/tools/BaseCornerGeometryReplacerTool';
import { type SnapHintsVisibility } from '@/lib/tools/BaseTool';
import { PolygonToolStatusTooltip, PreviewSegmentIntersection } from '@/lib/tools/PolygonTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { type SplitPoint, TrimSegment } from '@/lib/tools/TrimSplitTool';
import {
  WorkingConstraint,
  type WorkingDatum,
  type WorkingEllipse,
  type WorkingPolygon,
  type WorkingRectangle,
} from '@/lib/tools/types';
import { type DraggingShapeState } from '@/lib/tools/types';
import { Length } from '@/lib/units/length';
import { ViewportControls } from '@/lib/viewport/ViewportControls';
import {
  ScreenPosition,
  SheetPosition,
  ViewportControlsState,
  type ViewportState,
} from '@/lib/viewport/types';
import ConstraintLengthInput from './ConstraintLengthInput';
import CornerOverlay from './CornerOverlay';
import FitToScreenButton from './FitToScreenButton';
import { HoverTooltip } from './HoverTooltip';
import { KeyboardShortcut } from './KeyboardShortcut';

extend({
  Container,
  Graphics,
  Sprite,
});

/** Popup input rendered at the corner when the user has selected a corner vertex
 * and the tool is awaiting the offset distance. Auto-focuses on mount. */
function CornerOffsetDistancePopup(props: {
  cornerState: CornerState;
  viewportState: ViewportState;
  tool: BaseCornerGeometryReplacerTool<string>;
  sheet: Sheet;
}) {
  const inputRef = useRef<import('./ConstraintLengthInput').ConstraintLengthInputHandle>(null);
  const [value, setValue] = useState<Length | null>(null);

  useEffect(() => {
    const updateOffset = (event: { offset: Length | null; select: boolean }) => {
      setValue(event.offset);

      // Wait for the render to complete before focusing / selecting the input
      setTimeout(() => {
        inputRef.current?.focus();
        if (event.select) {
          inputRef.current?.select();
        }
      }, 50);
    };
    props.tool.on('currentOffsetChange', updateOffset);
    return () => {
      props.tool.off('currentOffsetChange', updateOffset);
    };
  }, [props.tool]);

  // Wait for the render to complete before focusing / selecting the input
  useEffect(() => {
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, []);

  const onAccept = useCallback(() => {
    if (!value) {
      return;
    }
    props.tool.commit();
  }, [props.tool, value]);

  const onDismiss = useCallback(() => {
    props.tool.handleToolBlur();
  }, [props.tool]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      } else if (e.key === 'Enter' && value) {
        e.preventDefault();
        e.stopPropagation();
        onAccept();
      }
    },
    [value, props.tool, onDismiss, onAccept],
  );

  const centerScreen = props.cornerState.centerPos.toWorld().toScreen(props.viewportState);

  return (
    <div
      className="absolute z-50"
      style={{ left: centerScreen.x + 8 /* spacing x */, top: centerScreen.y + 8 /* spacing y */ }}
      onKeyDown={handleKeyDown}
    >
      <ConstraintLengthInput
        ref={inputRef}
        value={value}
        placeholder="0"
        onChange={props.tool.onChangeCurrentOffset.bind(props.tool)}
        defaultUnit={props.sheet.defaultUnit}
        onDismissButtonClick={onDismiss}
        onAcceptButtonClick={onAccept}
      />
    </div>
  );
}

type ViewportRenderer2DProps = {
  sheet: Sheet;
  toolManager: ToolManager;
  actionsManager: ActionsManager;
  selectionManager: SelectionManager;
};

/**
 * Computes the position, length, and angle for rendering a sprite along a line segment.
 * Returns { centerX, centerY, length, angleDegrees } all in pixel coordinates.
 */
function computeLineSpriteTransform(
  startPosition: SheetPosition,
  endPosition: SheetPosition,
): {
  centerX: number;
  centerY: number;
  length: number;
  angleDegrees: number;
} {
  const startX = startPosition.x * SHEET_UNITS_TO_PIXELS;
  const startY = startPosition.y * SHEET_UNITS_TO_PIXELS;
  const endX = endPosition.x * SHEET_UNITS_TO_PIXELS;
  const endY = endPosition.y * SHEET_UNITS_TO_PIXELS;

  const centerX = (startX + endX) / 2;
  const centerY = (startY + endY) / 2;

  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.sqrt(dx * dx + dy * dy);

  const angleRadians = Math.atan2(dy, dx);
  const angleDegrees = angleRadians * (180 / Math.PI);

  return { centerX, centerY, length, angleDegrees };
}

function getRectangleStatusText(
  workingRectangle: WorkingRectangle | null,
  isCenterMode: boolean,
  shiftHeld: boolean,
): string {
  if (!workingRectangle || workingRectangle.firstPoint === null) {
    return isCenterMode ? 'Click to set center' : 'Click to set first corner';
  }
  if (shiftHeld) {
    return 'Click to set opposite corner (square)';
  }
  return 'Click to set opposite corner';
}

function getEllipseStatusText(
  workingEllipse: WorkingEllipse | null,
  isCenterMode: boolean,
  shiftHeld: boolean,
): string {
  if (!workingEllipse || workingEllipse.firstPoint === null) {
    return isCenterMode ? 'Click to set center' : 'Click to set bounding box corner';
  }
  if (shiftHeld) {
    return 'Click to set radius (circle)';
  }
  return 'Click to set radius point';
}

const SingleLayerRenderer: React.FunctionComponent<{
  layers: SingleLayers<React.ReactNode>;
  layerName: RendererLayers;
}> = (props) => {
  return props.layers[props.layerName];
};

function ListLayerRenderer<
  Item extends { id: Id },
  LR extends ListLayers<Item, React.ReactNode>,
>(props: { layers: LR; layerName: RendererLayers; items: Array<Item> }): React.ReactNode {
  const layer = props.layers[props.layerName];
  if (typeof layer !== 'function') {
    return layer;
  }

  return props.items.map((item) => <Fragment key={item.id}>{layer(item)}</Fragment>);
}

type ListLayersItemsPair<
  Item extends { id: Id } & Geometry<RenderOrderComponent> = {
    id: Id;
  } & Geometry<RenderOrderComponent>,
> = [ListLayers<Item, React.ReactNode>, Array<Item>];

function ListLayersRenderer<Pairs extends Array<ListLayersItemsPair>>(props: {
  layersItemsPairs: Pairs;
  layerName: RendererLayers;
}): React.ReactNode {
  const items = props.layersItemsPairs
    .flatMap(([layers, items], index) => {
      const layer = layers[props.layerName];
      if (typeof layer !== 'function') {
        return [{ key: `${index}`, renderOrder: 0, jsx: layer }];
      }

      return items.map((item) => ({
        key: item.id,
        renderOrder: RenderOrderComponent.get(item),
        jsx: layer(item),
      }));
    })
    .sort((a, b) => a.renderOrder - b.renderOrder);

  return items.map(({ key, jsx }) => <Fragment key={key}>{jsx}</Fragment>);
}

/**
 * Renders the CAD viewport with the sheet rectangle, adaptive grid lines, and polygons.
 * Handles mouse, touch, and wheel events via ViewportControls.
 */
export default function ViewportRenderer2D({
  sheet,
  toolManager,
  actionsManager,
  selectionManager,
}: ViewportRenderer2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportControlsRef = useRef<ViewportControls | null>(null);
  const [viewportControlsState, setViewportControlsState] = useState<ViewportControlsState | null>(
    null,
  );
  const [canvasDimensions, setCanvasDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [polygons, setPolygons] = useState<Array<Geometry<PolygonComponent>>>([]);
  const [workingPolygon, setWorkingPolygon] = useState<WorkingPolygon | null>(null);
  const [rectangles, setRectangles] = useState<Array<Rectangle>>([]);
  const [workingRectangle, setWorkingRectangle] = useState<WorkingRectangle | null>(null);
  const [ellipses, setEllipses] = useState<Array<Ellipse>>([]);
  const [datums, setDatums] = useState<Array<Datum>>([]);
  const [workingEllipse, setWorkingEllipse] = useState<WorkingEllipse | null>(null);
  const [workingDatum, setWorkingDatum] = useState<WorkingDatum | null>(null);
  const [workingConstraints, setWorkingConstraints] = useState<Array<WorkingConstraint>>([]);
  const [activeTool, setActiveTool] = useState(toolManager.getActiveTool());
  const [previewSheetPos, setPreviewSheetPos] = useState<{
    position: SheetPosition;
    isSnappedToKeyPoint: boolean;
  } | null>(null);
  const [polygonToolStatusTooltip, setPolygonToolStatusTooltip] =
    useState<PolygonToolStatusTooltip | null>(null);
  const [mouseScreenPos, setMouseScreenPos] = useState<ScreenPosition | null>(null);
  const [draggingShapeState, setDraggingShapeState] = useState<DraggingShapeState | null>(null);
  const [rectangleIsCenterMode, setRectangleIsCenterMode] = useState(false);
  const [ellipseIsCenterMode, setEllipseIsCenterMode] = useState(false);
  const [isHoveringPolygonEdge, setIsHoveringPolygonEdge] = useState(false);
  const [visibleTooltip, setVisibleTooltip] = useState<string | null>(null);
  const [closestPointToSegment, setClosestPointToSegment] = useState<{
    polygonId: string;
    segmentIndex: number;
    point: SheetPosition;
  } | null>(null);
  const [previewSegmentIntersections, setPreviewSegmentIntersections] = useState<
    Array<PreviewSegmentIntersection>
  >([]);
  const [previewSegmentIntersectionsEnabled, setPreviewSegmentIntersectionsEnabled] = useState(
    new Set<KeyCombo>(),
  );
  const [splitPointOrTrimSegment, setSplitPointOrTrimSegment] = useState<
    SplitPoint | TrimSegment | null
  >(null);
  const [keyPointSnapInfo, setKeyPointSnapInfo] = useState<KeyPointSnapInfo>(null);
  const [snapHintsVisibility, setSnapHintsVisibility] = useState<SnapHintsVisibility | null>(null);
  const [pendingCornerState, setPendingCornerState] = useState<CornerState | null>(null);
  const [activeCornerState, setActiveCornerState] = useState<CornerState | null>(null);

  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [superHeld, setSuperHeld] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);

  const handlePreviewUpdate = useCallback(
    (data: SheetPosition | { position: SheetPosition; isSnappedToKeyPoint: boolean } | null) => {
      if (data === null) {
        setPreviewSheetPos(null);
      } else if ('isSnappedToKeyPoint' in data) {
        setPreviewSheetPos(data);
      } else {
        setPreviewSheetPos({ position: data, isSnappedToKeyPoint: false });
      }
    },
    [],
  );

  useEffect(() => {
    const geometryStore = toolManager.getGeometryStore();

    toolManager.on('toolChange', setActiveTool);
    toolManager.on('subToolChange', setActiveTool);
    geometryStore.on('workingPolygonChanged', setWorkingPolygon);
    geometryStore.on('workingRectangleChanged', setWorkingRectangle);
    geometryStore.on('workingEllipseChanged', setWorkingEllipse);
    geometryStore.on('workingDatumChanged', setWorkingDatum);
    geometryStore.on('workingConstraintsChanged', setWorkingConstraints);

    const refreshAll = () => {
      setRectangles(
        geometryStore.listWithComponents(
          RectangleComponent,
          FillColorComponent,
          LinkDimensionsComponent,
          RenderOrderComponent,
        ),
      );
      setEllipses(
        geometryStore.listWithComponents(
          EllipseComponent,
          FillColorComponent,
          LinkDimensionsComponent,
          RenderOrderComponent,
        ),
      );
      setPolygons(geometryStore.listWithComponent(PolygonComponent));
      setDatums(geometryStore.listWithComponent(DatumComponent));
    };
    geometryStore.on('geometryAdded', refreshAll);
    geometryStore.on('geometryUpdated', refreshAll);
    geometryStore.on('geometryDeleted', refreshAll);

    toolManager.on('altChange', setAltHeld);
    toolManager.on('shiftChange', setShiftHeld);
    toolManager.on('superChange', setSuperHeld);
    toolManager.on('ctrlChange', setCtrlHeld);
    toolManager.on('keyPointSnapChange', setKeyPointSnapInfo);
    toolManager.on('snapHintsVisibilityChange', setSnapHintsVisibility);

    return () => {
      toolManager.off('toolChange', setActiveTool);
      toolManager.off('subToolChange', setActiveTool);
      geometryStore.off('workingPolygonChanged', setWorkingPolygon);
      geometryStore.off('workingRectangleChanged', setWorkingRectangle);
      geometryStore.off('workingEllipseChanged', setWorkingEllipse);
      geometryStore.off('workingDatumChanged', setWorkingDatum);
      geometryStore.off('workingConstraintsChanged', setWorkingConstraints);
      geometryStore.off('geometryAdded', refreshAll);
      geometryStore.off('geometryUpdated', refreshAll);
      geometryStore.off('geometryDeleted', refreshAll);

      toolManager.off('altChange', setAltHeld);
      toolManager.off('shiftChange', setShiftHeld);
      toolManager.off('superChange', setSuperHeld);
      toolManager.off('ctrlChange', setCtrlHeld);
      toolManager.off('keyPointSnapChange', setKeyPointSnapInfo);
      toolManager.off('snapHintsVisibilityChange', setSnapHintsVisibility);
    };
  }, [toolManager]);

  useEffect(() => {
    switch (activeTool.type) {
      case 'polygon': {
        activeTool.on('statusTooltipChange', setPolygonToolStatusTooltip);
        activeTool.on('previewSheetPositionChange', handlePreviewUpdate);
        activeTool.on('previewSegmentIntersections', setPreviewSegmentIntersections);
        activeTool.on('previewSegmentIntersectionsEnabled', setPreviewSegmentIntersectionsEnabled);
        return () => {
          activeTool.off('statusTooltipChange', setPolygonToolStatusTooltip);
          activeTool.off('previewSheetPositionChange', handlePreviewUpdate);
          activeTool.off('previewSegmentIntersections', setPreviewSegmentIntersections);
          activeTool.off(
            'previewSegmentIntersectionsEnabled',
            setPreviewSegmentIntersectionsEnabled,
          );
        };
      }
      case 'rectangle': {
        activeTool.on('isCenterModeChange', setRectangleIsCenterMode);
        activeTool.on('previewSheetPositionChange', handlePreviewUpdate);
        return () => {
          activeTool.off('isCenterModeChange', setRectangleIsCenterMode);
          activeTool.off('previewSheetPositionChange', handlePreviewUpdate);
        };
      }
      case 'ellipse': {
        activeTool.on('isCenterModeChange', setEllipseIsCenterMode);
        activeTool.on('previewSheetPositionChange', handlePreviewUpdate);
        return () => {
          activeTool.off('isCenterModeChange', setEllipseIsCenterMode);
          activeTool.off('previewSheetPositionChange', handlePreviewUpdate);
        };
      }

      case 'move': {
        // No events for this tool.
        return;
      }

      case 'select': {
        activeTool.on('dragStateChange', setDraggingShapeState);
        activeTool.on('closestPointToSegmentChange', setClosestPointToSegment);
        activeTool.on('hoveringPolygonSegmentChange', setIsHoveringPolygonEdge);
        activeTool.on('tooltipVisibilityChanged', setVisibleTooltip);
        return () => {
          activeTool.off('dragStateChange', setDraggingShapeState);
          activeTool.off('closestPointToSegmentChange', setClosestPointToSegment);
          activeTool.off('hoveringPolygonSegmentChange', setIsHoveringPolygonEdge);
          activeTool.off('tooltipVisibilityChanged', setVisibleTooltip);
        };
      }

      case 'constraint': {
        activeTool.on('previewSheetPositionChange', handlePreviewUpdate);
        return () => {
          activeTool.off('previewSheetPositionChange', handlePreviewUpdate);
        };
      }

      case 'edit': {
        // TrimSplit
        activeTool.on('splitPointOrTrimSegmentChange', setSplitPointOrTrimSegment);

        // Fillet / Chamfer
        activeTool.on('pendingCornerChange', setPendingCornerState);
        activeTool.on('activeCornerChange', setActiveCornerState);
        return () => {
          // Fillet / Chamfer
          activeTool.off('pendingCornerChange', setPendingCornerState);
          activeTool.off('activeCornerChange', setActiveCornerState);

          // TrimSplit
          activeTool.off('splitPointOrTrimSegmentChange', setSplitPointOrTrimSegment);
        };
      }
    }
  }, [activeTool]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        if (viewportControlsRef.current) {
          viewportControlsRef.current.resizeCanvas(width, height);
        }
        setCanvasDimensions({ width, height });
        setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
      }
    });

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;

    viewportControlsRef.current = new ViewportControls({
      canvasWidth: width,
      canvasHeight: height,
      sheet,
    });
    toolManager.setViewportControls(viewportControlsRef.current);
    setCanvasDimensions({ width, height });
    setViewportControlsState(viewportControlsRef.current.getState());

    const initialViewportState = viewportControlsRef.current.getState().viewport;
    toolManager.syncSnappingOptions(initialViewportState.scale);

    const onScaleChange = (scale: number) => {
      toolManager.syncSnappingOptions(scale);
    };
    const onNudgeCanvas = () => {
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };
    const onFitToViewport = () => {
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
      toolManager.syncSnappingOptions(viewportControlsRef.current?.getState().viewport.scale ?? 1);
    };

    viewportControlsRef.current.on('scaleChange', onScaleChange);
    viewportControlsRef.current.on('nudgeCanvas', onNudgeCanvas);
    viewportControlsRef.current.on('fitToViewport', onFitToViewport);

    viewportControlsRef.current.fitToViewport();

    return () => {
      viewportControlsRef.current?.off('scaleChange', onScaleChange);
      viewportControlsRef.current?.off('nudgeCanvas', onNudgeCanvas);
      viewportControlsRef.current?.off('fitToViewport', onFitToViewport);
    };
  }, [toolManager, sheet]);

  // Update the cursor when dictated to do so by a tool.
  useEffect(() => {
    if (!viewportControlsRef.current) {
      return;
    }

    const onCursorChange = () => {
      const cursor = viewportControlsRef.current?.getCursor() ?? toolManager.cursor;
      if (containerRef.current) {
        containerRef.current.style.cursor = cursor;
      }
    };

    const viewportControls = viewportControlsRef.current;
    viewportControls.on('cursorChange', onCursorChange);
    toolManager.on('cursorChange', onCursorChange);

    return () => {
      viewportControls.off('cursorChange', onCursorChange);
      toolManager.off('cursorChange', onCursorChange);
    };
  }, [toolManager, sheet]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      viewportControlsRef.current?.handleWheel(event);
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onMouseDown = (event: MouseEvent) => {
      viewportControlsRef.current?.handleMouseDown(event);
      if (viewportControlsRef.current) {
        const viewportState = viewportControlsRef.current.getState().viewport;
        const screenPos = new ScreenPosition(event.clientX, event.clientY);
        toolManager.handleMouseDown(screenPos, viewportState);
      }
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onMouseMove = (event: MouseEvent) => {
      viewportControlsRef.current?.handleMouseMove(event);
      if (viewportControlsRef.current) {
        const viewportState = viewportControlsRef.current.getState().viewport;
        const screenPos = new ScreenPosition(event.clientX, event.clientY);
        toolManager.handleMouseMove(screenPos, viewportState);
        setMouseScreenPos(new ScreenPosition(event.clientX, event.clientY));
      }
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onMouseUp = () => {
      viewportControlsRef.current?.handleMouseUp();
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onMouseLeave = () => {
      viewportControlsRef.current?.handleMouseLeave();
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onTouchStart = (event: TouchEvent) => {
      viewportControlsRef.current?.handleTouchStart(event);
    };

    const onTouchMove = (event: TouchEvent) => {
      viewportControlsRef.current?.handleTouchMove(event);
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onTouchEnd = () => {
      viewportControlsRef.current?.handleTouchEnd();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      for (const handleKeyDown of [
        toolManager.handleKeyDown.bind(toolManager),
        actionsManager.handleKeyDown.bind(actionsManager),
      ]) {
        if (handleKeyDown(event)) {
          break;
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      toolManager.handleKeyUp(event);
    };

    const container = containerRef.current;

    window.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mouseleave', onMouseLeave);
    container.addEventListener('touchstart', onTouchStart);
    window.addEventListener('touchmove', onTouchMove);
    container.addEventListener('touchend', onTouchEnd);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('wheel', onWheel);
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mouseleave', onMouseLeave);
      container.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [toolManager, activeTool, sheet]);

  const previewHandleSprites = useMemo(() => {
    if (previewSheetPos === null) {
      return [];
    }
    if (activeTool.type === 'polygon' && workingPolygon === null) {
      return [{ type: 'point' as const, point: previewSheetPos.position }];
    }
    if (activeTool.type === 'rectangle' && workingRectangle === null) {
      return [{ type: 'point' as const, point: previewSheetPos.position }];
    }
    if (activeTool.type === 'ellipse' && workingEllipse === null) {
      return [{ type: 'point' as const, point: previewSheetPos.position }];
    }
    if (activeTool.type === 'constraint') {
      return [{ type: 'point' as const, point: previewSheetPos.position }];
    }
    return [];
  }, [
    activeTool,
    workingPolygon,
    workingRectangle,
    workingEllipse,
    workingConstraints,
    previewSheetPos,
  ]);

  const viewportContextState = useMemo(
    () =>
      ({
        viewportScale: viewportControlsState?.viewport.scale ?? 1,
        viewportControls: viewportControlsRef.current,
        sheet,
        toolManager,
        activeTool,
        selectionManager,
        geometryStore: toolManager.getGeometryStore(),
        mouseScreenPos, // FIXME: break this out into another context, it will change often
        snapHintsVisibility,
      }) satisfies ViewportContextData,
    [
      sheet,
      toolManager,
      viewportControlsState?.viewport.scale,
      activeTool,
      selectionManager,
      mouseScreenPos,
    ],
  );

  const pixelRatio = useDevicePixelRatio();

  /** Renders all layers, using context from managers. */
  const renderLayer = (layerName: RendererLayers) => (
    <Fragment key={layerName}>
      {/* Constraints: */}
      <SingleLayerRenderer layers={ConstraintLayers} layerName={layerName} />

      {/* Filters: */}
      <SingleLayerRenderer layers={FilterLayers} layerName={layerName} />

      <ListLayersRenderer
        layersItemsPairs={[
          // FIXME: address type issues
          [PolygonLayers, polygons] as unknown as ListLayersItemsPair,
          [EllipseLayers, ellipses] as unknown as ListLayersItemsPair,
          [RectangleLayers, rectangles] as unknown as ListLayersItemsPair,
          [DatumLayers, datums] as unknown as ListLayersItemsPair,
        ]}
        layerName={layerName}
      />

      {/* Currently work in progress polygon: */}
      <SingleLayerRenderer layers={WorkingPolygonLayers} layerName={layerName} />
      {/* Currently work in progress ellipse: */}
      <SingleLayerRenderer layers={WorkingEllipseLayers} layerName={layerName} />
      {/* Currently work in progress rectangle: */}
      <SingleLayerRenderer layers={WorkingRectangleLayers} layerName={layerName} />
      {/* Currently work in progress datum: */}
      <SingleLayerRenderer layers={WorkingDatumLayers} layerName={layerName} />

      <SingleLayerRenderer layers={SnapsHintLayers} layerName={layerName} />

      <SingleLayerRenderer layers={DCELDebugRenderer} layerName={layerName} />
    </Fragment>
  );

  return (
    <ViewportContextProvider value={viewportContextState}>
      <div ref={containerRef} className="h-full w-full overflow-hidden bg-[#eeeeee]">
        <Application
          resizeTo={containerRef}
          backgroundColor={0xeeeeee}
          antialias={true}
          resolution={pixelRatio}
          autoDensity={true}
        >
          {/* Render a backdrop to capture clicks that weren't caught by something else. */}
          {canvasDimensions ? (
            <pixiSprite
              texture={Texture.WHITE}
              alpha={0}
              x={0}
              y={0}
              scale={{ x: canvasDimensions.width, y: canvasDimensions.height }}
              eventMode="static"
              onPointerDown={(event: FederatedMouseEvent) => {
                if (activeTool.type === 'select') {
                  selectionManager.clearSelection();

                  if (viewportControlsRef.current) {
                    activeTool.handleBackdropPointerDown(
                      new ScreenPosition(event.clientX, event.clientY),
                      viewportControlsRef.current,
                    );
                  }

                  // Clear any selected working constraints when clearing the selection
                  // TODO: move this into a manager
                  toolManager.getGeometryStore().setWorkingConstraints([]);
                  toolManager.getGeometryStore().setWorkingFilter(null);
                }
              }}
            />
          ) : null}

          {viewportControlsState ? (
            <pixiContainer
              x={viewportControlsState.viewport.position.x}
              y={viewportControlsState.viewport.position.y}
              scale={viewportControlsState.viewport.scale}
            >
              {canvasDimensions !== null ? (
                <SheetRenderer
                  sheet={sheet}
                  viewportControlsState={viewportControlsState}
                  canvasDimensions={canvasDimensions}
                />
              ) : null}

              {/* Render all pixi-rendered layers: */}
              {RENDERER_PIXI_LAYER_ORDER.map(renderLayer)}

              {/* Selection bounding box overlay (handles single and multi-select): */}
              <SelectionBoxOverlay />

              {/* Preview handle for rectangle/ellipse first point: */}
              {previewHandleSprites && previewHandleSprites.length > 0 && (
                <HandleSprites
                  points={previewHandleSprites.map((seg) => seg.point)}
                  handleTexture={VertexHandleTexture.get()}
                  viewportScale={viewportControlsState.viewport.scale}
                />
              )}

              {/* Render a fake handle when inserting a point on a polygon edge */}
              {activeTool.type === 'select' && isHoveringPolygonEdge && closestPointToSegment ? (
                <pixiSprite
                  texture={IntersectionVertexHandleTexture.get()}
                  x={closestPointToSegment.point.x * SHEET_UNITS_TO_PIXELS}
                  y={closestPointToSegment.point.y * SHEET_UNITS_TO_PIXELS}
                  anchor={{ x: 0.5, y: 0.5 }}
                  scale={{
                    x: 1 / viewportControlsState.viewport.scale,
                    y: 1 / viewportControlsState.viewport.scale,
                  }}
                />
              ) : null}

              {/* Render a fake handle when a possible split point has been found */}
              {activeTool.type === 'edit' &&
              activeTool.activeSubTool.type === 'trim-split' &&
              splitPointOrTrimSegment?.type === 'split-point' ? (
                <pixiSprite
                  texture={IntersectionVertexHandleTexture.get()}
                  x={splitPointOrTrimSegment.point.x * SHEET_UNITS_TO_PIXELS}
                  y={splitPointOrTrimSegment.point.y * SHEET_UNITS_TO_PIXELS}
                  anchor={{ x: 0.5, y: 0.5 }}
                  scale={{
                    x: 1 / viewportControlsState.viewport.scale,
                    y: 1 / viewportControlsState.viewport.scale,
                  }}
                />
              ) : null}

              {/* Render a highlight over the segment to be trimmed */}
              {activeTool.type === 'edit' &&
              activeTool.activeSubTool.type === 'trim-split' &&
              splitPointOrTrimSegment?.type === 'trim-segment' ? (
                <pixiSprite
                  texture={Texture.WHITE}
                  tint={0xe5484d /* var(--red-9) */}
                  x={
                    computeLineSpriteTransform(
                      splitPointOrTrimSegment.trimmedSegment.start,
                      splitPointOrTrimSegment.trimmedSegment.end,
                    ).centerX
                  }
                  y={
                    computeLineSpriteTransform(
                      splitPointOrTrimSegment.trimmedSegment.start,
                      splitPointOrTrimSegment.trimmedSegment.end,
                    ).centerY
                  }
                  angle={
                    computeLineSpriteTransform(
                      splitPointOrTrimSegment.trimmedSegment.start,
                      splitPointOrTrimSegment.trimmedSegment.end,
                    ).angleDegrees + 90
                  }
                  anchor={{ x: 0.5, y: 0.5 }}
                  scale={{
                    x: 5 / viewportControlsState.viewport.scale,
                    y: computeLineSpriteTransform(
                      splitPointOrTrimSegment.trimmedSegment.start,
                      splitPointOrTrimSegment.trimmedSegment.end,
                    ).length,
                  }}
                />
              ) : null}

              {/* Corner preview overlay for fillet/chamfer tools */}
              {activeTool.type === 'edit' &&
              (activeTool.activeSubTool.type === 'fillet' ||
                activeTool.activeSubTool.type === 'chamfer') &&
              pendingCornerState ? (
                <CornerOverlay
                  center={pendingCornerState.centerPos}
                  pointA={pendingCornerState.pointAPos}
                  pointB={pendingCornerState.pointBPos}
                  magnitude={2}
                  strokeWidth={3}
                  viewportScale={viewportControlsState.viewport.scale}
                />
              ) : null}
            </pixiContainer>
          ) : null}
        </Application>

        {/* Render all react dom-rendered layers: */}
        {RENDERER_DOM_LAYER_ORDER.map(renderLayer)}

        {activeTool.type === 'polygon' && mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <span>
                {
                  {
                    'place-first-point': 'Place first point',
                    'continue-polygon': 'Continue polygon',
                    'place-next-point': 'Place next point',
                    'place-arc-endpoint': 'Place arc endpoint',
                    'place-closing-arc-endpoint': 'Arc: close with...',
                    'arc-quadratic': 'Place quadratic arc control point',
                    'arc-cubic': 'Place cubic arc control point',
                    'close-polygon': 'Close polygon',
                    'close-arc-quadratic': 'Place quadratic arc control point',
                    'close-arc-cubic': 'Place cubic arc control point',
                  }[polygonToolStatusTooltip ?? 'place-first-point']
                }
              </span>
              <div className="flex items-center gap-2">
                {['arc-quadratic', 'close-arc-quadratic', 'arc-cubic', 'close-arc-cubic'].includes(
                  polygonToolStatusTooltip!,
                ) ? (
                  <KeyboardShortcut
                    label={
                      polygonToolStatusTooltip === 'arc-cubic' ||
                      polygonToolStatusTooltip === 'close-arc-cubic'
                        ? 'Quadratic'
                        : 'Cubic'
                    }
                  >
                    {polygonToolStatusTooltip === 'arc-cubic' ||
                    polygonToolStatusTooltip === 'close-arc-cubic'
                      ? 'M'
                      : 'B'}
                  </KeyboardShortcut>
                ) : (
                  <KeyboardShortcut label="Arc" disabled={altHeld}>
                    {PLATFORM_ALT_KEY_STRING}
                  </KeyboardShortcut>
                )}
                <KeyboardShortcut label="No snap" disabled={ctrlHeld}>
                  ctrl
                </KeyboardShortcut>
                <KeyboardShortcut label={<>Snap 15&deg;</>} disabled={superHeld}>
                  {PLATFORM_SUPER_KEY_STRING}
                </KeyboardShortcut>
              </div>
            </div>
          </HoverTooltip>
        ) : null}

        {previewSegmentIntersections.length > 0 && viewportControlsState && mouseScreenPos
          ? previewSegmentIntersections.map((inters, index) => {
              const position = inters.point.toWorld().toScreen(viewportControlsState.viewport);
              return (
                <HoverTooltip variant="secondary" position={position} key={index}>
                  <KeyboardShortcut
                    active={previewSegmentIntersectionsEnabled.has(inters.keyCombo)}
                    label="Split here?"
                  >
                    {inters.keyCombo}
                  </KeyboardShortcut>
                </HoverTooltip>
              );
            })
          : null}

        {activeTool.type === 'rectangle' && mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <span>
                {getRectangleStatusText(workingRectangle, rectangleIsCenterMode, shiftHeld)}
              </span>
              <div className="flex items-center gap-2">
                <KeyboardShortcut label="No snap" disabled={ctrlHeld}>
                  ctrl
                </KeyboardShortcut>
                <KeyboardShortcut label="Center mode" disabled={rectangleIsCenterMode}>
                  {PLATFORM_ALT_KEY_STRING}
                </KeyboardShortcut>
                <KeyboardShortcut label="Square" disabled={shiftHeld}>
                  shift
                </KeyboardShortcut>
              </div>
            </div>
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'ellipse' && mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <span>{getEllipseStatusText(workingEllipse, ellipseIsCenterMode, shiftHeld)}</span>
              <div className="flex items-center gap-2">
                <KeyboardShortcut label="No snap" disabled={ctrlHeld}>
                  ctrl
                </KeyboardShortcut>
                <KeyboardShortcut label="Center mode" disabled={ellipseIsCenterMode}>
                  {PLATFORM_ALT_KEY_STRING}
                </KeyboardShortcut>
                <KeyboardShortcut label="Circle" disabled={shiftHeld}>
                  shift
                </KeyboardShortcut>
              </div>
            </div>
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'select' && mouseScreenPos && draggingShapeState !== null ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <KeyboardShortcut label="No snap" disabled={ctrlHeld}>
                ctrl
              </KeyboardShortcut>
              {draggingShapeState.type === 'geometry-resize' ? (
                <KeyboardShortcut label="Around center" disabled={altHeld}>
                  {PLATFORM_ALT_KEY_STRING}
                </KeyboardShortcut>
              ) : null}
              {draggingShapeState.type === 'geometry-resize' ? (
                <KeyboardShortcut label="Keep aspect ratio" disabled={shiftHeld}>
                  shift
                </KeyboardShortcut>
              ) : null}
            </div>
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'constraint' &&
        (activeTool.activeSubTool.type === 'linear-constraint' ||
          activeTool.activeSubTool.type === 'linear-x-constraint' ||
          activeTool.activeSubTool.type === 'linear-y-constraint' ||
          activeTool.activeSubTool.type === 'horizontal-constraint' ||
          activeTool.activeSubTool.type === 'vertical-constraint') &&
        mouseScreenPos &&
        !keyPointSnapInfo ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <span>
                {workingConstraints.length === 0
                  ? 'Click to place start point'
                  : 'Click to place end point'}
              </span>
              <div className="flex items-center gap-2">
                <KeyboardShortcut label="No snap" disabled={ctrlHeld}>
                  ctrl
                </KeyboardShortcut>
                {workingConstraints.length > 0 ? (
                  <KeyboardShortcut label={<>Snap 15&deg;</>} disabled={superHeld}>
                    {PLATFORM_SUPER_KEY_STRING}
                  </KeyboardShortcut>
                ) : null}
              </div>
            </div>
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'constraint' &&
        activeTool.activeSubTool.type === 'perpendicular-constraint' &&
        mouseScreenPos &&
        !keyPointSnapInfo ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <span>
                {workingConstraints.length === 0
                  ? 'Click to place center point'
                  : 'Click to place end points'}
              </span>
              <div className="flex items-center gap-2">
                <KeyboardShortcut label="No snap" disabled={ctrlHeld}>
                  ctrl
                </KeyboardShortcut>
                {workingConstraints.length > 0 ? (
                  <KeyboardShortcut label={<>Snap 15&deg;</>} disabled={superHeld}>
                    {PLATFORM_SUPER_KEY_STRING}
                  </KeyboardShortcut>
                ) : null}
              </div>
            </div>
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'constraint' &&
        activeTool.activeSubTool.type === 'colinear-constraint' &&
        mouseScreenPos &&
        !keyPointSnapInfo ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <span>
                {workingConstraints.length === 0
                  ? 'Click to place target point'
                  : 'Click to place line points'}
              </span>
              <div className="flex items-center gap-2">
                <KeyboardShortcut label="No snap" disabled={ctrlHeld}>
                  ctrl
                </KeyboardShortcut>
                {workingConstraints.length > 0 ? (
                  <KeyboardShortcut label={<>Snap 15&deg;</>} disabled={superHeld}>
                    {PLATFORM_SUPER_KEY_STRING}
                  </KeyboardShortcut>
                ) : null}
              </div>
            </div>
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'constraint' &&
        activeTool.activeSubTool.type === 'datum' &&
        mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <span>Click to place datum</span>
              <div className="flex items-center gap-2">
                <KeyboardShortcut label="No snap" disabled={ctrlHeld}>
                  ctrl
                </KeyboardShortcut>
              </div>
            </div>
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'edit' &&
        (activeTool.activeSubTool.type === 'fillet' ||
          activeTool.activeSubTool.type === 'chamfer') &&
        mouseScreenPos &&
        !(activeCornerState && !pendingCornerState) ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              {pendingCornerState && !activeCornerState ? (
                <span>
                  Click to place {activeTool.activeSubTool.type === 'fillet' ? 'fillet' : 'chamfer'}
                </span>
              ) : null}
              {pendingCornerState && activeCornerState ? (
                <span>
                  Accept and place another{' '}
                  {activeTool.activeSubTool.type === 'fillet' ? 'fillet' : 'chamfer'}
                </span>
              ) : null}
              {!pendingCornerState ? <span>Hover over corner point</span> : null}
            </div>
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'select' && visibleTooltip === 'geometry-fill' && mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <KeyboardShortcut label="Duplicate" disabled={altHeld}>
                {PLATFORM_ALT_KEY_STRING}
              </KeyboardShortcut>
              {selectionManager.getSelectedIds().length > 0 ? (
                <KeyboardShortcut label="Add to selection" disabled={shiftHeld}>
                  shift
                </KeyboardShortcut>
              ) : null}
            </div>
          </HoverTooltip>
        ) : null}

        {keyPointSnapInfo && viewportControlsState ? (
          <HoverTooltip
            position={keyPointSnapInfo.sheetPosition
              .toWorld()
              .toScreen(viewportControlsState.viewport)}
          >
            Attach to keypoint
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'select' &&
        visibleTooltip === 'add-point' &&
        closestPointToSegment &&
        viewportControlsState ? (
          <HoverTooltip
            position={closestPointToSegment.point
              .toWorld()
              .toScreen(viewportControlsState.viewport)}
          >
            Add point
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'constraint' &&
        activeTool.activeSubTool.type === 'colinear-constraint' &&
        mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <span>
                {workingConstraints.length === 0
                  ? 'Click to place target point'
                  : 'Click to place line points'}
              </span>
              <div className="flex items-center gap-2">
                <KeyboardShortcut label="No snap" disabled={ctrlHeld}>
                  ctrl
                </KeyboardShortcut>
                {workingConstraints.length > 0 ? (
                  <KeyboardShortcut label={<>Snap 15&deg;</>} disabled={superHeld}>
                    {PLATFORM_SUPER_KEY_STRING}
                  </KeyboardShortcut>
                ) : null}
              </div>
            </div>
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'edit' &&
        activeTool.activeSubTool.type === 'trim-split' &&
        splitPointOrTrimSegment?.type === 'split-point' &&
        viewportControlsState ? (
          <HoverTooltip
            position={splitPointOrTrimSegment.point
              .toWorld()
              .toScreen(viewportControlsState.viewport)}
          >
            Add intersection point
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'edit' &&
        activeTool.activeSubTool.type === 'trim-split' &&
        splitPointOrTrimSegment?.type === 'trim-segment' &&
        mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>Trim segment</HoverTooltip>
        ) : null}

        {activeTool.type === 'edit' &&
        (activeTool.activeSubTool.type === 'fillet' ||
          activeTool.activeSubTool.type === 'chamfer') &&
        activeCornerState &&
        viewportControlsState ? (
          <CornerOffsetDistancePopup
            cornerState={activeCornerState}
            viewportState={viewportControlsState.viewport}
            tool={activeTool.activeSubTool as BaseCornerGeometryReplacerTool<string>}
            sheet={sheet}
          />
        ) : null}

        <FitToScreenButton onClick={() => viewportControlsRef.current?.fitToViewport()} />
      </div>
    </ViewportContextProvider>
  );
}
