import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  ConstraintEndpoint,
  type CubicBezierSegment,
  PointSegment,
  Polygon,
  PolygonComponent,
  Rectangle,
} from '@/lib/geometry';
import { GeometryStore, ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { DEFAULT_COLOR } from '@/lib/geometry/colors';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { SHEET_UNITS_TO_PIXELS, Sheet } from '@/lib/sheet/Sheet';
import { subscribeToEvents } from '@/lib/subscribe-to-events';
import { CornerState } from '@/lib/tools/BaseCornerGeometryReplacerTool';
import { FilletTool } from '@/lib/tools/FilletTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { CentimetersType, Length } from '@/lib/units/length';
import { ViewportControls } from '@/lib/viewport/ViewportControls';
import {
  ScreenPosition,
  SheetPosition,
  type ViewportState,
  WorldPosition,
} from '@/lib/viewport/types';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

function sheetToScreen(x: number, y: number, viewport: ViewportState): ScreenPosition {
  return new WorldPosition(x * SHEET_UNITS_TO_PIXELS, y * SHEET_UNITS_TO_PIXELS).toScreen(viewport);
}

function clickRectangleCorner(
  toolManager: ToolManager,
  geometryStore: GeometryStore,
  rect: Rectangle,
  cornerLabel: 'upperLeft' | 'upperRight' | 'lowerRight' | 'lowerLeft',
  viewport: ViewportState,
) {
  const endpoint = ConstraintEndpoint.lockedToRectangle(rect.id, cornerLabel);
  const pos = geometryStore.resolveConstraintEndpoint(endpoint);
  if (!pos) {
    throw new Error(`Could not resolve corner ${cornerLabel}`);
  }
  toolManager.handleMouseMove(sheetToScreen(pos.x, pos.y, viewport), viewport);
  toolManager.handleMouseDown(sheetToScreen(pos.x, pos.y, viewport), viewport);
  // Wait for the event to be dispatched synchronously
  return pos;
}

describe('FilletTool', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let selectionManager: SelectionManager;
  let actionsManager: ActionsManager;
  let toolManager: ToolManager;
  let viewport: ViewportState;
  let filletTool: FilletTool;
  let viewportControls: ViewportControls;

  beforeEach(() => {
    const sheet = Sheet.a4();
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    actionsManager = new ActionsManager(sheet, geometryStore, selectionManager, historyManager);
    historyManager.setGeometryStore(geometryStore);
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    toolManager.setSerializationManager(
      new SerializationManager(actionsManager, toolManager, sheet),
    );

    viewportControls = new ViewportControls({
      canvasWidth: 800,
      canvasHeight: 600,
      sheet,
    });
    toolManager.setViewportControls(viewportControls);
    viewport = viewportControls.getState().viewport;

    toolManager.setActiveTool('edit');
    toolManager.changeToolSubTool('edit', 'fillet');
    filletTool = toolManager.getTool('edit').activeSubTool as FilletTool;
  });

  describe('Rectangle', () => {
    let rect: Rectangle;
    beforeEach(() => {
      rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100), {
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      ) as Rectangle;
    });

    it('upperRight corner: arc at index 2, polygon starts at UL', () => {
      clickRectangleCorner(toolManager, geometryStore, rect, 'upperRight', viewport);

      filletTool.onChangeCurrentOffset(Length.centimeters(20));
      filletTool.commit();

      const polygons = geometryStore.listWithComponent(PolygonComponent);
      expect(polygons).toHaveLength(1);

      const points = PolygonComponent.get(polygons[0]).points;
      expect(points.length).toBe(6);

      // Point segments at indices 0,1,3,4,5
      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('arc-cubic');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('point');
      expect(points[5].type).toBe('point');

      // Point positions: UL -> split(80,0) -> arc -> LR -> LL -> UL
      expect(points[0].point.x).toBeCloseTo(0);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(80);
      expect(points[1].point.y).toBeCloseTo(0);
      expect(points[3].point.x).toBeCloseTo(100);
      expect(points[3].point.y).toBeCloseTo(100);
      expect(points[4].point.x).toBeCloseTo(0);
      expect(points[4].point.y).toBeCloseTo(100);
      expect(points[5].point.x).toBeCloseTo(0);
      expect(points[5].point.y).toBeCloseTo(0);
      expect(polygons[0].components.polygon.closed).toBe(true);

      // Arc destination = splitB on the vertical edge (100, 20)
      const arc = points[2] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(100);
      expect(arc.point.y).toBeCloseTo(20);

      // Control points should be non-trivial (tangent to both edges)
      expect(arc.controlPointA.x).toBeCloseTo(91.05, 2);
      expect(arc.controlPointA.y).toBeCloseTo(0, 2);
      expect(arc.controlPointB.x).toBeCloseTo(100);
      expect(arc.controlPointB.y).toBeCloseTo(8.95, 2);

      // Make sure rectangle horizontal/vertical constraints are attached to the right indexes
      const constraints = geometryStore.findConstraintsByGeometryId(polygons[0].id);
      expect(
        constraints
          .filter((c) => c.type === 'horizontal')
          .map((h) => {
            if (h.pointA.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(h)} point a not locked-polygon!`);
            }
            if (h.pointB.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(h)} point b not locked-polygon!`);
            }
            return `${h.pointA.pointIndex},${h.pointB.pointIndex}`;
          })
          .sort(),
      ).toEqual(['0,1', '3,4']);
      expect(
        constraints
          .filter((c) => c.type === 'vertical')
          .map((v) => {
            if (v.pointA.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(v)} point a not locked-polygon!`);
            }
            if (v.pointB.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(v)} point b not locked-polygon!`);
            }
            return `${v.pointA.pointIndex},${v.pointB.pointIndex}`;
          })
          .sort(),
      ).toEqual(['2,3', '4,0']);
    });

    it('lowerRight corner: arc at index 3', () => {
      clickRectangleCorner(toolManager, geometryStore, rect, 'lowerRight', viewport);

      filletTool.onChangeCurrentOffset(Length.centimeters(20));
      filletTool.commit();

      const polygons = geometryStore.listWithComponent(PolygonComponent);
      expect(polygons).toHaveLength(1);

      const points = PolygonComponent.get(polygons[0]).points;
      expect(points.length).toBe(6);

      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('point');
      expect(points[3].type).toBe('arc-cubic');
      expect(points[4].type).toBe('point');
      expect(points[5].type).toBe('point');

      // Polygon: UL -> UR -> split(100,80) -> arc -> LL -> UL
      expect(points[0].point.x).toBeCloseTo(0);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(100);
      expect(points[1].point.y).toBeCloseTo(0);
      expect(points[2].point.x).toBeCloseTo(100);
      expect(points[2].point.y).toBeCloseTo(80);
      expect(points[4].point.x).toBeCloseTo(0);
      expect(points[4].point.y).toBeCloseTo(100);
      expect(points[5].point.x).toBeCloseTo(0);
      expect(points[5].point.y).toBeCloseTo(0);
      expect(polygons[0].components.polygon.closed).toBe(true);

      const arc = points[3] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(80);
      expect(arc.point.y).toBeCloseTo(100);

      expect(arc.controlPointA.x).toBeCloseTo(100, 2);
      expect(arc.controlPointA.y).toBeCloseTo(91.05, 2);
      expect(arc.controlPointB.x).toBeCloseTo(91.05, 2);
      expect(arc.controlPointB.y).toBeCloseTo(100);

      // Make sure rectangle horizontal/vertical constraints are attached to the right indexes
      const constraints = geometryStore.findConstraintsByGeometryId(polygons[0].id);
      expect(
        constraints
          .filter((c) => c.type === 'horizontal')
          .map((h) => {
            if (h.pointA.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(h)} point a not locked-polygon!`);
            }
            if (h.pointB.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(h)} point b not locked-polygon!`);
            }
            return `${h.pointA.pointIndex},${h.pointB.pointIndex}`;
          })
          .sort(),
      ).toEqual(['0,1', '3,4']);
      expect(
        constraints
          .filter((c) => c.type === 'vertical')
          .map((v) => {
            if (v.pointA.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(v)} point a not locked-polygon!`);
            }
            if (v.pointB.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(v)} point b not locked-polygon!`);
            }
            return `${v.pointA.pointIndex},${v.pointB.pointIndex}`;
          })
          .sort(),
      ).toEqual(['1,2', '4,0']);
    });

    it('lowerLeft corner: arc at index 4', () => {
      clickRectangleCorner(toolManager, geometryStore, rect, 'lowerLeft', viewport);

      filletTool.onChangeCurrentOffset(Length.centimeters(20));
      filletTool.commit();

      const polygons = geometryStore.listWithComponent(PolygonComponent);
      expect(polygons).toHaveLength(1);

      const points = PolygonComponent.get(polygons[0]).points;
      expect(points.length).toBe(6);

      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('point');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('arc-cubic');
      expect(points[5].type).toBe('point');

      // Polygon: UL -> UR -> LR -> split(20,100) -> arc -> UL
      expect(points[0].point.x).toBeCloseTo(0);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(100);
      expect(points[1].point.y).toBeCloseTo(0);
      expect(points[2].point.x).toBeCloseTo(100);
      expect(points[2].point.y).toBeCloseTo(100);
      expect(points[3].point.x).toBeCloseTo(20);
      expect(points[3].point.y).toBeCloseTo(100);
      expect(points[5].point.x).toBeCloseTo(0);
      expect(points[5].point.y).toBeCloseTo(0);
      expect(polygons[0].components.polygon.closed).toBe(true);

      const arc = points[4] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(0);
      expect(arc.point.y).toBeCloseTo(80);

      expect(arc.controlPointA.x).toBeCloseTo(8.95, 2);
      expect(arc.controlPointA.y).toBeCloseTo(100, 2);
      expect(arc.controlPointB.x).toBeCloseTo(0, 2);
      expect(arc.controlPointB.y).toBeCloseTo(91.05, 2);

      // Make sure rectangle horizontal/vertical constraints are attached to the right indexes
      const constraints = geometryStore.findConstraintsByGeometryId(polygons[0].id);
      expect(
        constraints
          .filter((c) => c.type === 'horizontal')
          .map((h) => {
            if (h.pointA.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(h)} point a not locked-polygon!`);
            }
            if (h.pointB.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(h)} point b not locked-polygon!`);
            }
            return `${h.pointA.pointIndex},${h.pointB.pointIndex}`;
          })
          .sort(),
      ).toEqual(['0,1', '2,3']);
      expect(
        constraints
          .filter((c) => c.type === 'vertical')
          .map((v) => {
            if (v.pointA.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(v)} point a not locked-polygon!`);
            }
            if (v.pointB.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(v)} point b not locked-polygon!`);
            }
            return `${v.pointA.pointIndex},${v.pointB.pointIndex}`;
          })
          .sort(),
      ).toEqual(['1,2', '4,0']);
    });

    it('upperLeft corner: arc at the end (index 5), polygon no longer starts at UL', () => {
      clickRectangleCorner(toolManager, geometryStore, rect, 'upperLeft', viewport);

      filletTool.onChangeCurrentOffset(Length.centimeters(20));
      filletTool.commit();

      const polygons = geometryStore.listWithComponent(PolygonComponent);
      expect(polygons).toHaveLength(1);

      const points = PolygonComponent.get(polygons[0]).points;
      expect(points.length).toBe(6);

      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('point');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('point');
      expect(points[5].type).toBe('arc-cubic');

      // Polygon: split(20,0) -> UR -> LR -> LL -> split(0,20) -> arc -> split(20,0) closed
      // Does NOT start at UL(0,0) — wrapping case shifts the polygon start
      expect(points[0].point.x).toBeCloseTo(20);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(100);
      expect(points[1].point.y).toBeCloseTo(0);
      expect(points[2].point.x).toBeCloseTo(100);
      expect(points[2].point.y).toBeCloseTo(100);
      expect(points[3].point.x).toBeCloseTo(0);
      expect(points[3].point.y).toBeCloseTo(100);
      expect(points[4].point.x).toBeCloseTo(0);
      expect(points[4].point.y).toBeCloseTo(20);
      expect(polygons[0].components.polygon.closed).toBe(true);

      const arc = points[5] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(20);
      expect(arc.point.y).toBeCloseTo(0);

      expect(arc.controlPointA.x).toBeCloseTo(0, 2);
      expect(arc.controlPointA.y).toBeCloseTo(8.95, 2);
      expect(arc.controlPointB.x).toBeCloseTo(8.95, 2);
      expect(arc.controlPointB.y).toBeCloseTo(0, 2);

      // Make sure rectangle horizontal/vertical constraints are attached to the right indexes
      const constraints = geometryStore.findConstraintsByGeometryId(polygons[0].id);
      expect(
        constraints
          .filter((c) => c.type === 'horizontal')
          .map((h) => {
            if (h.pointA.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(h)} point a not locked-polygon!`);
            }
            if (h.pointB.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(h)} point b not locked-polygon!`);
            }
            return `${h.pointA.pointIndex},${h.pointB.pointIndex}`;
          })
          .sort(),
      ).toEqual(['0,1', '2,3']);
      expect(
        constraints
          .filter((c) => c.type === 'vertical')
          .map((v) => {
            if (v.pointA.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(v)} point a not locked-polygon!`);
            }
            if (v.pointB.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(v)} point b not locked-polygon!`);
            }
            return `${v.pointA.pointIndex},${v.pointB.pointIndex}`;
          })
          .sort(),
      ).toEqual(['1,2', '3,4']);
    });

    it('upperRight then lowerRight corner should create two arcs', () => {
      toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(100, 0, viewport), viewport);

      filletTool.onChangeCurrentOffset(Length.centimeters(20));
      filletTool.commit();

      let polygons = geometryStore.listWithComponent(PolygonComponent);
      expect(polygons).toHaveLength(1);

      let points = PolygonComponent.get(polygons[0]).points;
      expect(points.length).toBe(6);

      // Point segments at indices 0,1,3,4,5
      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('arc-cubic');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('point');
      expect(points[5].type).toBe('point');

      // Point positions: UL -> split(80,0) -> arc -> LR -> LL -> UL
      expect(points[0].point.x).toBeCloseTo(0);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(80);
      expect(points[1].point.y).toBeCloseTo(0);
      expect(points[3].point.x).toBeCloseTo(100);
      expect(points[3].point.y).toBeCloseTo(100);
      expect(points[4].point.x).toBeCloseTo(0);
      expect(points[4].point.y).toBeCloseTo(100);
      expect(points[5].point.x).toBeCloseTo(0);
      expect(points[5].point.y).toBeCloseTo(0);
      expect(polygons[0].components.polygon.closed).toBe(true);

      // Arc destination = splitB on the vertical edge (100, 20)
      const arc = points[2] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(100);
      expect(arc.point.y).toBeCloseTo(20);

      // Now, click lower right corner
      toolManager.handleMouseMove(sheetToScreen(100, 100, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(100, 100, viewport), viewport);
      filletTool.onChangeCurrentOffset(Length.centimeters(20));
      filletTool.commit();

      polygons = geometryStore.listWithComponent(PolygonComponent);
      expect(polygons).toHaveLength(1);

      // After clicking the lower right corner, there should be another new arc added
      points = PolygonComponent.get(polygons[0]).points;
      expect(points.length).toBe(7);

      // Point segments at indices 0,1,3,4,5
      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('arc-cubic');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('arc-cubic');
      expect(points[5].type).toBe('point');
      expect(points[6].type).toBe('point');

      // Point positions: UL -> split(80,0) -> arc -> split(80, 0) -> LR -> LL -> UL
      expect(points[0].point.x).toBeCloseTo(0);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(80);
      expect(points[1].point.y).toBeCloseTo(0);
      expect(points[2].point.x).toBeCloseTo(100); // Arc A
      expect(points[2].point.y).toBeCloseTo(20);
      expect(points[3].point.x).toBeCloseTo(100);
      expect(points[3].point.y).toBeCloseTo(80);
      expect(points[4].point.x).toBeCloseTo(80); // Arc B
      expect(points[4].point.y).toBeCloseTo(100);
      expect(points[5].point.x).toBeCloseTo(0);
      expect(points[5].point.y).toBeCloseTo(100);
      expect(points[6].point.x).toBeCloseTo(0);
      expect(points[6].point.y).toBeCloseTo(0);
      expect(polygons[0].components.polygon.closed).toBe(true);

      // Arc destination = splitB on the vertical edge (100, 20)
      const arcA = points[2] as CubicBezierSegment;
      expect(arcA.controlPointA.x).toBeCloseTo(91.05, 2);
      expect(arcA.controlPointA.y).toBeCloseTo(0, 2);
      expect(arcA.controlPointB.x).toBeCloseTo(100);
      expect(arcA.controlPointB.y).toBeCloseTo(8.95, 2);

      const arcB = points[4] as CubicBezierSegment;
      expect(arcB.controlPointA.x).toBeCloseTo(100, 2);
      expect(arcB.controlPointA.y).toBeCloseTo(91.05, 2);
      expect(arcB.controlPointB.x).toBeCloseTo(91.05, 2);
      expect(arcB.controlPointB.y).toBeCloseTo(100);
    });

    describe('pending hover state', () => {
      it('should allow hovering over all rectangle corner points', async () => {
        const events = subscribeToEvents(filletTool, ['pendingCornerChange']);

        // Hover over upper left
        toolManager.handleMouseMove(sheetToScreen(0, 0, viewport), viewport);
        let event = await events.waitFor<CornerState | null>('pendingCornerChange');

        expect(event?.mode).toStrictEqual('rectangle');
        if (event?.mode !== 'rectangle') {
          throw new Error('not rectangle');
        }
        expect(event?.pointAEndpoint).toStrictEqual('lowerLeft');
        expect(event?.pointAPos.x).toStrictEqual(0);
        expect(event?.pointAPos.y).toStrictEqual(100);
        expect(event?.centerEndpoint).toStrictEqual('upperLeft');
        expect(event?.centerPos.x).toStrictEqual(0);
        expect(event?.centerPos.y).toStrictEqual(0);
        expect(event?.pointBEndpoint).toStrictEqual('upperRight');
        expect(event?.pointBPos.x).toStrictEqual(100);
        expect(event?.pointBPos.y).toStrictEqual(0);

        // Hover over upper right
        toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
        event = await events.waitFor<CornerState | null>('pendingCornerChange');

        expect(event?.mode).toStrictEqual('rectangle');
        if (event?.mode !== 'rectangle') {
          throw new Error('not rectangle');
        }
        expect(event?.pointAEndpoint).toStrictEqual('lowerRight');
        expect(event?.pointAPos.x).toStrictEqual(100);
        expect(event?.pointAPos.y).toStrictEqual(100);
        expect(event?.centerEndpoint).toStrictEqual('upperRight');
        expect(event?.centerPos.x).toStrictEqual(100);
        expect(event?.centerPos.y).toStrictEqual(0);
        expect(event?.pointBEndpoint).toStrictEqual('upperLeft');
        expect(event?.pointBPos.x).toStrictEqual(0);
        expect(event?.pointBPos.y).toStrictEqual(0);

        // Hover over lower right
        toolManager.handleMouseMove(sheetToScreen(100, 100, viewport), viewport);
        event = await events.waitFor<CornerState | null>('pendingCornerChange');

        expect(event?.mode).toStrictEqual('rectangle');
        if (event?.mode !== 'rectangle') {
          throw new Error('not rectangle');
        }
        expect(event?.pointAEndpoint).toStrictEqual('lowerLeft');
        expect(event?.pointAPos.x).toStrictEqual(0);
        expect(event?.pointAPos.y).toStrictEqual(100);
        expect(event?.centerEndpoint).toStrictEqual('lowerRight');
        expect(event?.centerPos.x).toStrictEqual(100);
        expect(event?.centerPos.y).toStrictEqual(100);
        expect(event?.pointBEndpoint).toStrictEqual('upperRight');
        expect(event?.pointBPos.x).toStrictEqual(100);
        expect(event?.pointBPos.y).toStrictEqual(0);

        // Hover over lower left
        toolManager.handleMouseMove(sheetToScreen(0, 100, viewport), viewport);
        event = await events.waitFor<CornerState | null>('pendingCornerChange');

        expect(event?.mode).toStrictEqual('rectangle');
        if (event?.mode !== 'rectangle') {
          throw new Error('not rectangle');
        }
        expect(event?.pointAEndpoint).toStrictEqual('lowerRight');
        expect(event?.pointAPos.x).toStrictEqual(100);
        expect(event?.pointAPos.y).toStrictEqual(100);
        expect(event?.centerEndpoint).toStrictEqual('lowerLeft');
        expect(event?.centerPos.x).toStrictEqual(0);
        expect(event?.centerPos.y).toStrictEqual(100);
        expect(event?.pointBEndpoint).toStrictEqual('upperLeft');
        expect(event?.pointBPos.x).toStrictEqual(0);
        expect(event?.pointBPos.y).toStrictEqual(0);
      });
      it('should disallow hovering over active rectangle corner points', async () => {
        const events = subscribeToEvents(filletTool, ['pendingCornerChange', 'activeCornerChange']);

        // Hovering over upper left works
        toolManager.handleMouseMove(sheetToScreen(0, 0, viewport), viewport);
        let event = await events.waitFor<CornerState | null>('pendingCornerChange');

        expect(event?.mode).toStrictEqual('rectangle');
        if (event?.mode !== 'rectangle') {
          throw new Error('not rectangle');
        }
        expect(event?.centerEndpoint).toStrictEqual('upperLeft');

        // Click to make upper left the active point
        toolManager.handleMouseDown(sheetToScreen(0, 0, viewport), viewport);

        // And make sure an activeCornerChange event is emitted
        event = await events.waitFor<CornerState | null>('activeCornerChange');
        expect(event?.mode).toStrictEqual('rectangle');
        if (event?.mode !== 'rectangle') {
          throw new Error('not rectangle');
        }
        expect(event?.centerEndpoint).toStrictEqual('upperLeft');

        // Now, hovering over the upper right point should still work
        toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
        event = await events.waitFor<CornerState | null>('pendingCornerChange');

        expect(event?.mode).toStrictEqual('rectangle');
        if (event?.mode !== 'rectangle') {
          throw new Error('not rectangle');
        }
        expect(event?.centerEndpoint).toStrictEqual('upperRight');

        // But not the upper left, since it is active
        toolManager.handleMouseMove(sheetToScreen(0, 0, viewport), viewport);
        expect(events.areThereBufferedEvents('activeCornerChange')).toBeFalsy();
      });
      it('should be able to click corner points before the current one to add fillets to each', async () => {
        const events = subscribeToEvents(filletTool, ['pendingCornerChange', 'activeCornerChange']);

        // Click to add a fillet on the lower right point
        toolManager.handleMouseMove(sheetToScreen(100, 100, viewport), viewport);
        toolManager.handleMouseDown(sheetToScreen(100, 100, viewport), viewport);

        // Set a length, but do NOT commit it
        filletTool.onChangeCurrentOffset(Length.centimeters(20));

        events.clearBufferedEvents();

        // Now hover / click on the upper left corner (before lower right)
        toolManager.handleMouseMove(sheetToScreen(0, 0, viewport), viewport);
        toolManager.handleMouseDown(sheetToScreen(0, 0, viewport), viewport);

        // This should cause the first fillet to get committed
        let polygonGeometry = geometryStore.listWithComponent(PolygonComponent)[0];
        let points = PolygonComponent.get(polygonGeometry).points;
        expect(points.filter((p) => p.type === 'arc-cubic')).toHaveLength(1);

        // And the second fillet to get made active.
        // First a no-op event:
        let event = await events.waitFor<CornerState | null>('activeCornerChange');
        expect(event).toBeNull();
        // Then the actual event:
        event = await events.waitFor<CornerState | null>('activeCornerChange');
        expect(event?.mode).toStrictEqual('polygon');
        if (event?.mode !== 'polygon') {
          throw new Error('not polygon');
        }
        expect(event?.centerIndex).toStrictEqual(0);

        // And the current offset length should have persisted
        expect(filletTool.currentOffset?.type).toStrictEqual(CentimetersType);
        expect(filletTool.currentOffset?.magnitude).toStrictEqual(20);
      });
      it('should be able to click corner points after the current one to add fillets to each', async () => {
        const events = subscribeToEvents(filletTool, ['pendingCornerChange', 'activeCornerChange']);

        // Click to add a fillet on the lower right point
        toolManager.handleMouseMove(sheetToScreen(100, 100, viewport), viewport);
        toolManager.handleMouseDown(sheetToScreen(100, 100, viewport), viewport);

        // Set a length, but do NOT commit it
        filletTool.onChangeCurrentOffset(Length.centimeters(20));

        events.clearBufferedEvents();

        // Now hover / click on the lower left corner (after lower right)
        toolManager.handleMouseMove(sheetToScreen(0, 100, viewport), viewport);
        toolManager.handleMouseDown(sheetToScreen(0, 100, viewport), viewport);

        // This should cause the first fillet to get committed
        let polygonGeometry = geometryStore.listWithComponent(PolygonComponent)[0];
        let points = PolygonComponent.get(polygonGeometry).points;
        expect(points.filter((p) => p.type === 'arc-cubic')).toHaveLength(1);

        // And the second fillet to get made active.
        // First a no-op event:
        let event = await events.waitFor<CornerState | null>('activeCornerChange');
        expect(event).toBeNull();
        // Then the actual event:
        event = await events.waitFor<CornerState | null>('activeCornerChange');
        expect(event?.mode).toStrictEqual('polygon');
        if (event?.mode !== 'polygon') {
          throw new Error('not polygon');
        }
        expect(event?.centerIndex).toStrictEqual(
          3 /* expected index */ + 1 /* extra point from fillet */,
        );

        // And the current offset length should have persisted
        expect(filletTool.currentOffset?.type).toStrictEqual(CentimetersType);
        expect(filletTool.currentOffset?.magnitude).toStrictEqual(20);
      });
    });
  });

  describe('Polygon', () => {
    it('middle point of a closed triangular polygon', () => {
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(100, 0), makePoint(100, 100), makePoint(0, 0)], {
          closed: true,
        }),
      );

      toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(100, 0, viewport), viewport);

      filletTool.onChangeCurrentOffset(Length.centimeters(20));
      filletTool.commit();

      const polygons = geometryStore.listWithComponent(PolygonComponent);
      expect(polygons).toHaveLength(1);

      const points = PolygonComponent.get(polygons[0]).points;
      expect(points.length).toBe(5);

      // Point segments at indices 0,1,3,4,5
      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('arc-cubic');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('point');

      // Point positions: UL -> split(80,0) -> arc -> LR -> LL -> UL
      expect(points[0].point.x).toBeCloseTo(0);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(80);
      expect(points[1].point.y).toBeCloseTo(0);
      expect(points[3].point.x).toBeCloseTo(100);
      expect(points[3].point.y).toBeCloseTo(100);
      expect(points[4].point.x).toBeCloseTo(0);
      expect(points[4].point.y).toBeCloseTo(0);
      expect(polygons[0].components.polygon.closed).toBe(true);

      // Arc destination = splitB on the vertical edge (100, 20)
      const arc = points[2] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(100);
      expect(arc.point.y).toBeCloseTo(20);

      // Control points should be non-trivial (tangent to both edges)
      expect(arc.controlPointA.x).toBeCloseTo(91.05, 2);
      expect(arc.controlPointA.y).toBeCloseTo(0, 2);
      expect(arc.controlPointB.x).toBeCloseTo(100);
      expect(arc.controlPointB.y).toBeCloseTo(8.95, 2);
    });
    it('starting point of a closed triangular polygon', () => {
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [makePoint(100, 0), makePoint(100, 100), makePoint(0, 0), makePoint(100, 0)],
          { closed: true },
        ),
      );

      toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(100, 0, viewport), viewport);

      filletTool.onChangeCurrentOffset(Length.centimeters(20));
      filletTool.commit();

      const polygons = geometryStore.listWithComponent(PolygonComponent);
      expect(polygons).toHaveLength(1);

      const points = PolygonComponent.get(polygons[0]).points;
      expect(points.length).toBe(5);

      // Point segments at indices 0,1,2,3
      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('point');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('arc-cubic');

      // Point positions: UL -> split(80,0) -> arc -> LR -> LL -> UL
      expect(points[0].point.x).toBeCloseTo(100);
      expect(points[0].point.y).toBeCloseTo(20);
      expect(points[1].point.x).toBeCloseTo(100);
      expect(points[1].point.y).toBeCloseTo(100);
      expect(points[2].point.x).toBeCloseTo(0);
      expect(points[2].point.y).toBeCloseTo(0);
      expect(points[3].point.x).toBeCloseTo(80);
      expect(points[3].point.y).toBeCloseTo(0);
      expect(points[4].point.x).toBeCloseTo(100);
      expect(points[4].point.y).toBeCloseTo(20);
      expect(polygons[0].components.polygon.closed).toBe(true);

      // Arc destination = splitB on the vertical edge (100, 20)
      const arc = points[4] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(100);
      expect(arc.point.y).toBeCloseTo(20);

      // Control points should be non-trivial (tangent to both edges)
      expect(arc.controlPointA.x).toBeCloseTo(91.05, 2);
      expect(arc.controlPointA.y).toBeCloseTo(0, 2);
      expect(arc.controlPointB.x).toBeCloseTo(100);
      expect(arc.controlPointB.y).toBeCloseTo(8.95, 2);
    });
    it('should not be able to place a fillet on a point where one side is arc-cubic / arc-quadratic', async () => {
      const events = subscribeToEvents(filletTool, ['pendingCornerChange']);

      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            makePoint(0, 0),
            {
              type: 'arc-quadratic',
              point: new SheetPosition(100, 100),
              controlPoint: new SheetPosition(50, 50),
            },
            makePoint(0, 100),
          ],
          { closed: true },
        ),
      );

      toolManager.handleMouseMove(sheetToScreen(100, 100, viewport), viewport);

      expect(await events.waitFor('pendingCornerChange')).toBeNull();
    });
  });
});
