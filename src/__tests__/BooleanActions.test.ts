import { ActionsManager } from '@/lib/actions/ActionsManager';
import { FillColorComponent, PolygonComponent, Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { SheetPosition } from '@/lib/viewport/types';

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
      const { id: rect1Id } = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10), {
          fillColor: 0x0000ff,
          linkDimensions: false,
        }),
      );
      const { id: rect2Id } = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(5, 0), new SheetPosition(15, 10), {
          fillColor: 0x00ff00,
          linkDimensions: false,
        }),
      );

      selectionManager.select(rect1Id);
      selectionManager.select(rect2Id);

      await actionsManager.execute('union');

      // Should have created a new polygon
      expect(geometryStore.listWithComponent(PolygonComponent).length).toBe(1);
      const resultPolygon = geometryStore.listWithComponent(PolygonComponent)[0];

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
      const { id: rect1Id } = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10), {
          fillColor: 0x0000ff,
          linkDimensions: false,
        }),
      );
      const { id: rect2Id } = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(5, 0), new SheetPosition(15, 10), {
          fillColor: 0x00ff00,
          linkDimensions: false,
        }),
      );

      selectionManager.select(rect1Id);
      selectionManager.select(rect2Id);

      await actionsManager.execute('difference');

      // Should have created a new polygon
      expect(geometryStore.listWithComponent(PolygonComponent).length).toBe(1);
      const resultPolygon = geometryStore.listWithComponent(PolygonComponent)[0];

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

    it('creates multiple polygons when difference splits a shape into disjoint islands', async () => {
      // Create a wide rectangle from (0,0) to (20,10)
      // Subtract a middle rectangle from (7,0) to (13,10)
      // This splits the large rectangle into two separate islands:
      //   Left: (0,0)-(7,0)-(7,10)-(0,10)
      //   Right: (13,0)-(20,0)-(20,10)-(13,10)
      const { id: rect1Id } = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(20, 10), {
          fillColor: 0x0000ff,
          linkDimensions: false,
        }),
      );
      const { id: rect2Id } = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(7, 0), new SheetPosition(13, 10), {
          fillColor: 0x00ff00,
          linkDimensions: false,
        }),
      );

      selectionManager.select(rect1Id);
      selectionManager.select(rect2Id);

      await actionsManager.execute('difference');

      const resultPolygons = geometryStore.listWithComponent(PolygonComponent);

      // Should have created two polygons (left and right islands)
      expect(resultPolygons.length).toBe(2);

      // Both polygons should be selected
      expect(selectionManager.getSelectedIds().length).toBe(2);

      // Both should have the first polygon's color (blue)
      expect(FillColorComponent.getOptional(resultPolygons[0])).toBe(0x0000ff);
      expect(FillColorComponent.getOptional(resultPolygons[1])).toBe(0x0000ff);

      // Verify the x-coordinates span the correct ranges
      // Left island points should all have x <= 7
      // Right island points should all have x >= 13
      const p0Xs = PolygonComponent.get(resultPolygons[0]).points.map((p) => p.point.x);
      const p1Xs = PolygonComponent.get(resultPolygons[1]).points.map((p) => p.point.x);
      const l0AllLeft = p0Xs.every((x: number) => x <= 7.001);
      const l0AllRight = p0Xs.every((x: number) => x >= 12.999);
      const l1AllLeft = p1Xs.every((x: number) => x <= 7.001);
      const l1AllRight = p1Xs.every((x: number) => x >= 12.999);
      // One polygon should be entirely in the left region, the other in the right
      expect((l0AllLeft && l1AllRight) || (l0AllRight && l1AllLeft)).toBe(true);
    });
  });

  describe('IntersectionAction', () => {
    it('intersects two overlapping rectangles into the overlapping region', async () => {
      // Create two rectangles that overlap
      // Rect 1: (0,0) to (10,10)
      // Rect 2: (5,0) to (15,10)
      // Expected intersection: (5,0) to (10,10) - the overlapping region
      const { id: rect1Id } = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10), {
          fillColor: 0x0000ff,
          linkDimensions: false,
        }),
      );
      const { id: rect2Id } = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(5, 0), new SheetPosition(15, 10), {
          fillColor: 0x00ff00,
          linkDimensions: false,
        }),
      );

      selectionManager.select(rect1Id);
      selectionManager.select(rect2Id);

      await actionsManager.execute('intersection');

      // Should have created a new polygon
      expect(geometryStore.listWithComponent(PolygonComponent).length).toBe(1);
      const resultPolygon = geometryStore.listWithComponent(PolygonComponent)[0];

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
