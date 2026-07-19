import { createContext, useContext } from 'react';
import { type Entity } from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { type Filter } from '@/lib/entity/filters';
import { type Geometry } from '@/lib/entity/geometry';
import { type Sheet } from '@/lib/sheet/Sheet';
import { type SnapHintsVisibility } from '@/lib/tools/BaseTool';
import { type SelectionManager } from '@/lib/tools/SelectionManager';
import { type Tool, type ToolManager } from '@/lib/tools/ToolManager';
import { ViewportControls } from '@/lib/viewport/ViewportControls';
import { ScreenPosition } from '@/lib/viewport/types';

export type ViewportContextData = {
  viewportScale: number;
  viewportControls: ViewportControls | null;

  sheet: Sheet;
  toolManager: ToolManager;
  activeTool: Tool;
  selectionManager: SelectionManager;
  geometryStore: GeometryStore;
  mouseScreenPos: ScreenPosition | null;
  snapHintsVisibility: SnapHintsVisibility | null;
  highlightedGeometryId: Entity['id'] | null;
  filtersByGeometryId: Map<Geometry['id'], Array<Filter>>;
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
