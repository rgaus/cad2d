import { ActionsManager } from '@/lib/actions/ActionsManager';
import { Ellipse, Polygon, PolygonSegment, Rectangle, RenderOrderComponent } from '@/lib/geometry';
import { GeometryStore, ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { SheetPosition } from '@/lib/viewport/types';

function makePolygon(overrides: {
  id: string;
  points: Array<PolygonSegment>;
  closed?: boolean;
  fillColor?: number | null;
  openAtIndex?: number;
  renderOrder?: number;
}): Polygon {
  const template = Polygon.create(overrides.points, {
    closed: overrides.closed,
    fillColor: overrides.fillColor,
    openAtIndex: overrides.openAtIndex,
  });
  const renderOrder = overrides.renderOrder ?? 0;
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(renderOrder),
    },
  };
}

function makeRectangle(overrides: {
  id: string;
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
  fillColor?: number | null;
  linkDimensions?: boolean;
  renderOrder?: number;
}): Rectangle {
  const template = Rectangle.create(overrides.upperLeft, overrides.lowerRight, {
    fillColor: overrides.fillColor,
    linkDimensions: overrides.linkDimensions,
  });
  const renderOrder = overrides.renderOrder ?? 0;
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(renderOrder),
    },
  };
}

function makeEllipse(overrides: {
  id: string;
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
  fillColor?: number | null;
  linkDimensions?: boolean;
  renderOrder?: number;
}): Ellipse {
  const template = Ellipse.create(overrides.center, {
    radiusX: overrides.radiusX,
    radiusY: overrides.radiusY,
    fillColor: overrides.fillColor,
    linkDimensions: overrides.linkDimensions,
  });
  const renderOrder = overrides.renderOrder ?? 0;
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(renderOrder),
    },
  };
}

describe('SelectAllAction', () => {
  let geometryStore: GeometryStore;
  let selectionManager: SelectionManager;
  let historyManager: HistoryManager;
  let toolManager: ToolManager;
  let actionsManager: ActionsManager;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    actionsManager = new ActionsManager(
      Sheet.a4(),
      geometryStore,
      selectionManager,
      historyManager,
    );
    actionsManager.setToolManager(toolManager);
  });

  describe('execute', () => {
    it('selects all geometry and switches to select tool', async () => {
      const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
      const rectangleId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);

      geometryStore.addDirect(
        makePolygon({
          id: polygonId,
          points: [
            { type: 'point' as const, point: new SheetPosition(0, 0) },
            { type: 'point' as const, point: new SheetPosition(1, 0) },
            { type: 'point' as const, point: new SheetPosition(1, 1) },
            { type: 'point' as const, point: new SheetPosition(0, 0) },
          ],
          closed: true,
          fillColor: null,
          openAtIndex: 0,
          renderOrder: 0,
        }),
      );
      geometryStore.addDirect(
        makeRectangle({
          id: rectangleId,
          upperLeft: new SheetPosition(2, 2),
          lowerRight: new SheetPosition(4, 4),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );
      geometryStore.addDirect(
        makeEllipse({
          id: ellipseId,
          center: new SheetPosition(6, 6),
          radiusX: 1,
          radiusY: 2,
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      // Start with polygon tool
      toolManager.setActiveTool('polygon');

      // Execute select all
      await actionsManager.execute('select-all');

      // Should have switched to select tool
      expect(toolManager.getActiveTool().type).toBe('select');

      // Should have selected all geometry
      expect(selectionManager.getSelectedIds()).toEqual([polygonId, rectangleId, ellipseId]);

      // Make sure now that everything is sslected, the tool is disabled
      const selectAllAction = actionsManager.getAction('select-all');
      expect(selectAllAction.disabled).toBe(true);
    });

    it('is enabled when select tool is active and not everything selected', () => {
      toolManager.setActiveTool('select');
      geometryStore.addDirect(
        makePolygon({
          id: 'test',
          points: [
            { type: 'point' as const, point: new SheetPosition(0, 0) },
            { type: 'point' as const, point: new SheetPosition(1, 0) },
          ],
          closed: true,
          fillColor: null,
          openAtIndex: 0,
          renderOrder: 0,
        }),
      );
      const selectAllAction = actionsManager.getAction('select-all');
      expect(selectAllAction.disabled).toBe(false);
    });
  });
});
