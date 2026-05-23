import { GeometryStore, ID_PREFIXES } from '../lib/tools/GeometryStore';
import { SelectionManager } from '../lib/tools/SelectionManager';
import { HistoryManager } from '../lib/history/HistoryManager';
import { ToolManager } from '../lib/tools/ToolManager';
import { ActionsManager } from '../lib/actions/ActionsManager';
import { Sheet } from '../lib/sheet/Sheet';
import { SheetPosition } from '../lib/viewport/types';

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
    actionsManager = new ActionsManager(Sheet.a4(), geometryStore, selectionManager, historyManager);
    actionsManager.setToolManager(toolManager);
  });

  describe('execute', () => {
    it('selects all geometry and switches to select tool', async () => {
      const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
      const rectangleId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);

      geometryStore.polygons.push({
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
      });
      geometryStore.rectangles.push({
        id: rectangleId,
        upperLeft: new SheetPosition(2, 2),
        lowerRight: new SheetPosition(4, 4),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      });
      geometryStore.ellipses.push({
        id: ellipseId,
        center: new SheetPosition(6, 6),
        radiusX: 1,
        radiusY: 2,
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      });

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
      geometryStore.polygons.push({
        id: 'test',
        points: [{ type: 'point' as const, point: new SheetPosition(0, 0) }],
        closed: true,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
      });
      const selectAllAction = actionsManager.getAction('select-all');
      expect(selectAllAction.disabled).toBe(false);
    });
  });
});
