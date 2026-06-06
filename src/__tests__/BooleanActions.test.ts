import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  FillColorComponent,
  PolygonComponent,
  Rectangle,
  RenderOrderComponent,
} from '@/lib/geometry';
import { GeometryStore, ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { SheetPosition } from '@/lib/viewport/types';

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

describe('BooleanActions', () => {
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

  describe('UnionAction', () => {
    it('unions two overlapping rectangles into a combined polygon', async () => {
      // Create two rectangles that overlap
      // Rect 1: (0,0) to (10,10)
      // Rect 2: (5,0) to (15,10)
      // Expected union: (0,0) to (15,10)
      const rect1Id = historyManager.generateStableId(ID_PREFIXES.rectangle);
      const rect2Id = historyManager.generateStableId(ID_PREFIXES.rectangle);

      geometryStore.addDirect(
        makeRectangle({
          id: rect1Id,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 10),
          fillColor: 0x0000ff,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      geometryStore.addDirect(
        makeRectangle({
          id: rect2Id,
          upperLeft: new SheetPosition(5, 0),
          lowerRight: new SheetPosition(15, 10),
          fillColor: 0x00ff00,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      selectionManager.select(rect1Id);
      selectionManager.select(rect2Id);

      await actionsManager.execute('union');

      // Should have created a new polygon
      expect(geometryStore.polygons.length).toBe(1);
      const resultPolygon = geometryStore.polygons[0];

      // Polygon should have 4 unique corners (closed polygon has 5 points - first/last same)
      expect(PolygonComponent.get(resultPolygon).points).toHaveLength(5);
      // First point equals last point (closed polygon)
      expect(PolygonComponent.get(resultPolygon).points[0].point.x).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[0].point.y).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[4].point.x).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[4].point.y).toBeCloseTo(0);
      // The 4 unique corners in order
      expect(PolygonComponent.get(resultPolygon).points[0].point.x).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[0].point.y).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[1].point.x).toBeCloseTo(15);
      expect(PolygonComponent.get(resultPolygon).points[1].point.y).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[2].point.x).toBeCloseTo(15);
      expect(PolygonComponent.get(resultPolygon).points[2].point.y).toBeCloseTo(10);
      expect(PolygonComponent.get(resultPolygon).points[3].point.x).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[3].point.y).toBeCloseTo(10);

      // Result should have first polygon's color (blue)
      expect(FillColorComponent.getOptional(resultPolygon)).toBe(0x0000ff);
    });
  });

  describe('DifferenceAction', () => {
    it('subtracts second rectangle from first rectangle', async () => {
      // Create two rectangles that overlap
      // Rect 1: (0,0) to (10,10)
      // Rect 2: (5,0) to (15,10)
      // Expected difference: (0,0) to (5,10) - the left portion that remains
      const rect1Id = historyManager.generateStableId(ID_PREFIXES.rectangle);
      const rect2Id = historyManager.generateStableId(ID_PREFIXES.rectangle);

      geometryStore.addDirect(
        makeRectangle({
          id: rect1Id,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 10),
          fillColor: 0x0000ff,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      geometryStore.addDirect(
        makeRectangle({
          id: rect2Id,
          upperLeft: new SheetPosition(5, 0),
          lowerRight: new SheetPosition(15, 10),
          fillColor: 0x00ff00,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      selectionManager.select(rect1Id);
      selectionManager.select(rect2Id);

      await actionsManager.execute('difference');

      // Should have created a new polygon
      expect(geometryStore.polygons.length).toBe(1);
      const resultPolygon = geometryStore.polygons[0];

      // Polygon should be the remaining left portion (0,0), (5,0), (5,10), (0,10) - closed has 5 points
      expect(PolygonComponent.get(resultPolygon).points).toHaveLength(5);
      // First point equals last point (closed polygon)
      expect(PolygonComponent.get(resultPolygon).points[0].point.x).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[0].point.y).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[4].point.x).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[4].point.y).toBeCloseTo(0);
      // The 4 unique corners in order
      expect(PolygonComponent.get(resultPolygon).points[0].point.x).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[0].point.y).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[1].point.x).toBeCloseTo(5);
      expect(PolygonComponent.get(resultPolygon).points[1].point.y).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[2].point.x).toBeCloseTo(5);
      expect(PolygonComponent.get(resultPolygon).points[2].point.y).toBeCloseTo(10);
      expect(PolygonComponent.get(resultPolygon).points[3].point.x).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[3].point.y).toBeCloseTo(10);

      // Result should have first polygon's color (blue)
      expect(FillColorComponent.getOptional(resultPolygon)).toBe(0x0000ff);
    });
  });

  describe('IntersectionAction', () => {
    it('intersects two overlapping rectangles into the overlapping region', async () => {
      // Create two rectangles that overlap
      // Rect 1: (0,0) to (10,10)
      // Rect 2: (5,0) to (15,10)
      // Expected intersection: (5,0) to (10,10) - the overlapping region
      const rect1Id = historyManager.generateStableId(ID_PREFIXES.rectangle);
      const rect2Id = historyManager.generateStableId(ID_PREFIXES.rectangle);

      geometryStore.addDirect(
        makeRectangle({
          id: rect1Id,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 10),
          fillColor: 0x0000ff,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      geometryStore.addDirect(
        makeRectangle({
          id: rect2Id,
          upperLeft: new SheetPosition(5, 0),
          lowerRight: new SheetPosition(15, 10),
          fillColor: 0x00ff00,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      selectionManager.select(rect1Id);
      selectionManager.select(rect2Id);

      await actionsManager.execute('intersection');

      // Should have created a new polygon
      expect(geometryStore.polygons.length).toBe(1);
      const resultPolygon = geometryStore.polygons[0];

      // Polygon should be the overlapping region (5,0), (10,0), (10,10), (5,10) - closed has 5 points
      expect(PolygonComponent.get(resultPolygon).points).toHaveLength(5);
      // First point equals last point (closed polygon)
      expect(PolygonComponent.get(resultPolygon).points[0].point.x).toBeCloseTo(5);
      expect(PolygonComponent.get(resultPolygon).points[0].point.y).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[4].point.x).toBeCloseTo(5);
      expect(PolygonComponent.get(resultPolygon).points[4].point.y).toBeCloseTo(0);
      // The 4 unique corners in order
      expect(PolygonComponent.get(resultPolygon).points[0].point.x).toBeCloseTo(5);
      expect(PolygonComponent.get(resultPolygon).points[0].point.y).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[1].point.x).toBeCloseTo(10);
      expect(PolygonComponent.get(resultPolygon).points[1].point.y).toBeCloseTo(0);
      expect(PolygonComponent.get(resultPolygon).points[2].point.x).toBeCloseTo(10);
      expect(PolygonComponent.get(resultPolygon).points[2].point.y).toBeCloseTo(10);
      expect(PolygonComponent.get(resultPolygon).points[3].point.x).toBeCloseTo(5);
      expect(PolygonComponent.get(resultPolygon).points[3].point.y).toBeCloseTo(10);

      // Result should have first polygon's color (blue)
      expect(FillColorComponent.getOptional(resultPolygon)).toBe(0x0000ff);
    });
  });
});
