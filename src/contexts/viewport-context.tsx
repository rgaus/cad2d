import { type Sheet } from '@/lib/sheet/Sheet';
import { GeometryStore } from '@/lib/tools/GeometryStore';
import { type SelectionManager } from '@/lib/tools/SelectionManager';
import { type Tool, type ToolManager } from '@/lib/tools/ToolManager';
import { DraggingShapeState, ScreenPosition, SheetPosition, type Ellipse } from '@/lib/tools/types';
import { ViewportControls } from '@/lib/viewport/ViewportControls';
import { createContext, useContext, useEffect, useState } from 'react';

export type ViewportContextData = {
  viewportScale: number;
  viewportControls: ViewportControls | null;

  sheet: Sheet;
  toolManager: ToolManager;
  activeTool: Tool;
  selectionManager: SelectionManager;
  geometryStore: GeometryStore;
  mouseScreenPos: ScreenPosition | null;
};
const ViewportContext = createContext<ViewportContextData | null>(null);

/** A context provider which contains data required to render the viewport. */
export const useViewportContext = () => {
  const data = useContext(ViewportContext);
  if (!data) {
    throw new Error('useViewportContext: Not used from within a ViewportContext.');
  }
  return data;
};

export const ViewportContextProvider = ViewportContext.Provider;


export const useSelectionManagerSelectedIds = () => {
  const { selectionManager } = useViewportContext();

  const [selectedIds, setSelectedIds] = useState(selectionManager.getSelectedIds());
  useEffect(() => {
    selectionManager.on('selectionChange', setSelectedIds);
    return () => {
      selectionManager.off('selectionChange', setSelectedIds);
    };
  }, [selectionManager]);

  return selectedIds;
};

export const useDraggingShapeState = () => {
  const { activeTool } = useViewportContext();

  const [draggingShapeState, setDraggingShapeState] = useState<DraggingShapeState | null>(null);

  useEffect(() => {
    if (activeTool.type !== 'select') {
      return;
    }
    activeTool.on('dragStateChange', setDraggingShapeState);
    return () => {
      activeTool.off('dragStateChange', setDraggingShapeState);
    };
  }, [activeTool]);

  return draggingShapeState;
};

export const useClosestPointToSegment = () => {
  const { activeTool } = useViewportContext();

  const [closestPointToSegment, setClosestPointToSegment] = useState<{ polygonId: string; segmentIndex: number; point: SheetPosition } | null>(null);

  useEffect(() => {
    if (activeTool.type !== 'select') {
      return;
    }
    activeTool.on('closestPointToSegmentChange', setClosestPointToSegment);
    return () => {
      activeTool.off('closestPointToSegmentChange', setClosestPointToSegment);
    };
  }, [activeTool]);

  return closestPointToSegment;
};
