import {
  Datum,
  DatumComponent,
  Ellipse,
  EllipseComponent,
  FillColorComponent,
  type PointSegment,
  Polygon,
  PolygonComponent,
  Rectangle,
  RectangleComponent,
} from '@/lib/geometry';
import { GeometryStore, ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { ConstraintEndpoint, LinearConstraint } from '@/lib/geometry/constraints';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { subscribeToEvents } from '@/lib/subscribe-to-events';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

describe('GeometryStore', () => {
  let historyManager: HistoryManager;
  let store: GeometryStore;

  beforeEach(() => {
    historyManager = new HistoryManager();
    store = new GeometryStore(historyManager);
    historyManager.setGeometryStore(store);
  });

  describe('addPolygon', () => {
    it('adds polygon to array', () => {
      const polygon = store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(1, 0)], {
          closed: true,
          openAtIndex: 0,
          fillColor: null,
        }),
      );
      expect(store.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(store.listWithComponent(PolygonComponent)[0].id).toBe(polygon.id);
      expect(PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points).toEqual([
        makePoint(0, 0),
        makePoint(1, 0),
      ]);
    });

    it('generates a stable id for new polygons', () => {
      const polygon1 = store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(1, 0)], {
          closed: false,
          openAtIndex: 0,
          fillColor: null,
        }),
      );
      const polygon2 = store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(1, 1), makePoint(2, 1)], {
          closed: false,
          openAtIndex: 0,
          fillColor: null,
        }),
      );
      expect(polygon1.id).not.toBe(polygon2.id);
      expect(typeof polygon1.id).toBe('string');
      expect(polygon1.id.length).toBeGreaterThan(0);
    });

    it('emits polygonAdded event', async () => {
      const events = subscribeToEvents(store, ['geometryAdded']);
      const polygon = store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(1, 0)], {
          closed: false,
          openAtIndex: 0,
          fillColor: null,
        }),
      );
      const payload = await events.waitFor('geometryAdded');
      expect(payload).toEqual(polygon);
    });

    it('emits geometryAdded event for polygons', async () => {
      const events = subscribeToEvents(store, ['geometryAdded']);
      const polygon = store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(1, 0)], {
          closed: false,
          openAtIndex: 0,
          fillColor: null,
        }),
      );
      const payload = await events.waitFor('geometryAdded');
      expect(payload).toEqual(polygon);
    });
  });

  describe('updatePolygon', () => {
    it('updates existing polygon', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(1, 0)], {
          closed: false,
          openAtIndex: 0,
          fillColor: null,
        }),
      );
      const id = store.listWithComponent(PolygonComponent)[0].id;
      store.updateByIdWithComponentDirect(id, PolygonComponent, (old) =>
        PolygonComponent.update(old, { closed: true }),
      );
      expect(PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).closed).toBe(true);
    });

    it('does nothing for non-existent id', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(1, 0)], {
          closed: false,
          openAtIndex: 0,
          fillColor: null,
        }),
      );
      store.updateByIdWithComponentDirect('nonexistent' as any, PolygonComponent, (old) =>
        PolygonComponent.update(old, { closed: true }),
      );
      expect(PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).closed).toBe(false);
    });
  });

  describe('deletePolygon', () => {
    it('removes polygon by id', () => {
      const polygon = store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(1, 0)], {
          closed: false,
          openAtIndex: 0,
          fillColor: null,
        }),
      );
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(1, 1), makePoint(2, 1)], {
          closed: false,
          openAtIndex: 0,
          fillColor: null,
        }),
      );
      store.deleteById(polygon.id);
      expect(store.listWithComponent(PolygonComponent)).toHaveLength(1);
    });
  });

  describe('workingPolygon', () => {
    it('setWorkingPolygon sets working polygon', () => {
      const wp = {
        points: [makePoint(0, 0), makePoint(1, 0)],
        previewPoint: null,
        pendingArcEndPoint: null,
        source: { type: 'empty' as const },
      };
      store.setWorkingPolygon(wp);
      expect(store.workingPolygon).toEqual(wp);
    });

    it('clearWorkingPolygon clears working polygon', () => {
      store.setWorkingPolygon({
        points: [makePoint(0, 0), makePoint(1, 0)],
        previewPoint: null,
        pendingArcEndPoint: null,
        source: { type: 'empty' as const },
      });
      store.clearWorkingPolygon();
      expect(store.workingPolygon).toBeNull();
    });

    it('emits workingPolygonChanged on setWorkingPolygon', async () => {
      const wp = {
        points: [makePoint(0, 0), makePoint(1, 0)],
        previewPoint: null,
        pendingArcEndPoint: null,
        source: { type: 'empty' as const },
      };
      const events = subscribeToEvents(store, ['workingPolygonChanged']);
      store.setWorkingPolygon(wp);
      const payload = await events.waitFor('workingPolygonChanged');
      expect(payload).toEqual(wp);
    });

    it('emits workingPolygonChanged on clearWorkingPolygon', async () => {
      store.setWorkingPolygon({
        points: [makePoint(0, 0), makePoint(1, 0)],
        previewPoint: null,
        pendingArcEndPoint: null,
        source: { type: 'empty' as const },
      });
      const events = subscribeToEvents(store, ['workingPolygonChanged']);
      store.clearWorkingPolygon();
      const payload = await events.waitFor('workingPolygonChanged');
      expect(payload).toEqual(null);
    });
  });

  describe('addPointOnLineSegmentEdge', () => {
    it('inserts a point at the specified edge position', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(10, 10), makePoint(0, 10)], {
          closed: true,
          fillColor: null,
          openAtIndex: 0,
        }),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;
      store.addPointOnLineSegmentEdge(polygonId, 0, new SheetPosition(5, 0));
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(5);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[1].point,
      ).toEqual(new SheetPosition(5, 0));
    });

    it('inserts point at the exact click position regardless of edge midpoint', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(10, 10)], {
          closed: false,
          fillColor: null,
          openAtIndex: 0,
        }),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;
      store.addPointOnLineSegmentEdge(polygonId, 1, new SheetPosition(7, 3));
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[2].point.x,
      ).toBeCloseTo(7, 5);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[2].point.y,
      ).toBeCloseTo(3, 5);
    });

    it('inserts point after the edge being split (index + 1 position)', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(10, 10)], {
          closed: false,
          fillColor: null,
          openAtIndex: 0,
        }),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;
      store.addPointOnLineSegmentEdge(polygonId, 0, new SheetPosition(5, 0));
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[0].point.x,
      ).toBeCloseTo(0, 5);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[0].point.y,
      ).toBeCloseTo(0, 5);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[1].point.x,
      ).toBeCloseTo(5, 5);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[1].point.y,
      ).toBeCloseTo(0, 5);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[2].point.x,
      ).toBeCloseTo(10, 5);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[2].point.y,
      ).toBeCloseTo(0, 5);
    });

    it('does nothing for non-existent polygon id', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0)], {
          closed: false,
          fillColor: null,
          openAtIndex: 0,
        }),
      );
      store.addPointOnLineSegmentEdge('nonexistent' as any, 0, new SheetPosition(5, 0));
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(2);
    });

    it('does nothing for arc segments', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(0, 0) },
            {
              type: 'arc-quadratic',
              point: new SheetPosition(10, 0),
              controlPoint: new SheetPosition(5, -5),
            },
            makePoint(10, 10),
          ],
          { closed: false, openAtIndex: 0, fillColor: null },
        ),
      );
      store.addPointOnLineSegmentEdge(
        store.listWithComponent(PolygonComponent)[0].id,
        0,
        new SheetPosition(5, 0),
      );
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(3);
    });

    it('records the operation to history for undo', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(10, 10)], {
          closed: false,
          fillColor: null,
          openAtIndex: 0,
        }),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;
      store.addPointOnLineSegmentEdge(polygonId, 1, new SheetPosition(10, 5));
      expect(historyManager.canUndo()).toBe(true);
    });

    it('can undo and redo the point insertion', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(10, 10), makePoint(0, 10)], {
          closed: true,
          fillColor: null,
          openAtIndex: 0,
        }),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;
      const originalPoint = PolygonComponent.get(store.listWithComponent(PolygonComponent)[0])
        .points[0].point;
      store.addPointOnLineSegmentEdge(polygonId, 0, new SheetPosition(5, 0));
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(5);

      historyManager.undo();
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(4);

      historyManager.redo();
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(5);
    });

    it('offsets locked-polygon constraint pointIndex when inserting before a constrained vertex', () => {
      // Create a 4-vertex closed polygon: p0(0,0), p1(10,0), p2(10,10), p3(0,10)
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(10, 10), makePoint(0, 10)], {
          closed: true,
          fillColor: null,
          openAtIndex: 0,
        }),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;

      // Add a linear constraint locked to p2 (index 2) and p3 (index 3) — both should shift
      store.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygonId, 2),
          ConstraintEndpoint.lockedToPolygon(polygonId, 3),
          Length.centimeters(10),
        ),
      );

      // Insert a new point on edge between p1(index 1) and p2(index 2) — shifts indices >= 2 by +1
      store.addPointOnLineSegmentEdge(polygonId, 1, new SheetPosition(5, 10));

      const constraints = store.findConstraintsByGeometryId(polygonId);
      expect(constraints).toHaveLength(1);

      const endpointA = (constraints[0] as any).pointA;
      const endpointB = (constraints[0] as any).pointB;
      expect(endpointA.type).toBe('locked-polygon');
      expect(endpointA.pointIndex).toBe(3); // was 2, now 3
      expect(endpointB.type).toBe('locked-polygon');
      expect(endpointB.pointIndex).toBe(4); // was 3, now 4
    });

    it('does not offset locked-polygon constraint pointIndex when point is before the constrained vertex', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(10, 10), makePoint(0, 10)], {
          closed: true,
          fillColor: null,
          openAtIndex: 0,
        }),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;

      // Add a constraint locked to p0 (index 0) and p1 (index 1) — before the insertion, should NOT shift
      store.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygonId, 0),
          ConstraintEndpoint.lockedToPolygon(polygonId, 1),
          Length.centimeters(10),
        ),
      );

      // Insert on edge between p2(index 2) and p3(index 3) — pointIndex >= 3 shift by +1
      store.addPointOnLineSegmentEdge(polygonId, 2, new SheetPosition(5, 10));

      const constraints = store.findConstraintsByGeometryId(polygonId);
      expect(constraints).toHaveLength(1);

      const endpointA = (constraints[0] as any).pointA;
      const endpointB = (constraints[0] as any).pointB;
      expect(endpointA.pointIndex).toBe(0); // unchanged
      expect(endpointB.pointIndex).toBe(1); // unchanged
    });

    it('reverts constraint pointIndices on undo and restores them on redo', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(10, 10), makePoint(0, 10)], {
          closed: true,
          fillColor: null,
          openAtIndex: 0,
        }),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;

      store.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygonId, 2),
          ConstraintEndpoint.lockedToPolygon(polygonId, 3),
          Length.centimeters(10),
        ),
      );

      store.addPointOnLineSegmentEdge(polygonId, 1, new SheetPosition(5, 10));

      // Verify re-indexing happened
      let constraints = store.findConstraintsByGeometryId(polygonId);
      expect((constraints[0] as any).pointA.pointIndex).toBe(3);
      expect((constraints[0] as any).pointB.pointIndex).toBe(4);
      expect(historyManager.canUndo()).toBe(true);

      // Undo should revert both geometry AND constraints
      historyManager.undo();
      const polygonAfterUndo = store.listWithComponent(PolygonComponent)[0];
      expect(PolygonComponent.get(polygonAfterUndo).points).toHaveLength(4);
      constraints = store.findConstraintsByGeometryId(polygonId);
      expect((constraints[0] as any).pointA.pointIndex).toBe(2);
      expect((constraints[0] as any).pointB.pointIndex).toBe(3);

      // Redo should restore both
      historyManager.redo();
      const polygonAfterRedo = store.listWithComponent(PolygonComponent)[0];
      expect(PolygonComponent.get(polygonAfterRedo).points).toHaveLength(5);
      constraints = store.findConstraintsByGeometryId(polygonId);
      expect((constraints[0] as any).pointA.pointIndex).toBe(3);
      expect((constraints[0] as any).pointB.pointIndex).toBe(4);

      // Everything in a single undo transaction — the most recent entry should be a transaction
      const undoStack = historyManager.getUndoStack();
      expect(undoStack[undoStack.length - 1].type).toBe('transaction');
    });
  });

  describe('addPointOnQuadraticEdge', () => {
    it('splits a quadratic arc at the given t parameter', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            makePoint(0, 0),
            {
              type: 'arc-quadratic',
              point: new SheetPosition(10, 0),
              controlPoint: new SheetPosition(5, -5),
            },
          ],
          { closed: false, openAtIndex: 0, fillColor: null },
        ),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;
      store.addPointOnQuadraticEdge(polygonId, 0, 0.5);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(3);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[0].type,
      ).toBe('point');
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[1].type,
      ).toBe('arc-quadratic');
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[2].type,
      ).toBe('arc-quadratic');
    });

    it('records the operation to history for undo', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            makePoint(0, 0),
            {
              type: 'arc-quadratic',
              point: new SheetPosition(10, 0),
              controlPoint: new SheetPosition(5, -5),
            },
          ],
          { closed: false, openAtIndex: 0, fillColor: null },
        ),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;
      store.addPointOnQuadraticEdge(polygonId, 0, 0.5);
      expect(historyManager.canUndo()).toBe(true);
    });

    it('can undo and redo the curve split', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            makePoint(0, 0),
            {
              type: 'arc-quadratic',
              point: new SheetPosition(10, 0),
              controlPoint: new SheetPosition(5, -5),
            },
          ],
          { closed: false, openAtIndex: 0, fillColor: null },
        ),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;
      store.addPointOnQuadraticEdge(polygonId, 0, 0.5);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(3);

      historyManager.undo();
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(2);

      historyManager.redo();
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(3);
    });

    it('offsets locked-polygon constraint pointIndex when splitting a quadratic edge', () => {
      // Polygon: p0(point), p1(arc-quadratic to (10,0)), p2(point at (10,10))
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            makePoint(0, 0),
            {
              type: 'arc-quadratic',
              point: new SheetPosition(10, 0),
              controlPoint: new SheetPosition(5, -5),
            },
            makePoint(10, 10),
          ],
          { closed: false, openAtIndex: 0, fillColor: null },
        ),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;

      // Constraint referencing p2 (index 2) — should shift to index 3 after split
      store.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygonId, 2),
          ConstraintEndpoint.lockedToPolygon(polygonId, 0),
          Length.centimeters(10),
        ),
      );

      store.addPointOnQuadraticEdge(polygonId, 0, 0.5);

      const constraints = store.findConstraintsByGeometryId(polygonId);
      expect(constraints).toHaveLength(1);
      expect((constraints[0] as any).pointA.pointIndex).toBe(3); // was 2
      expect((constraints[0] as any).pointB.pointIndex).toBe(0); // unchanged
    });
  });

  describe('addPointOnCubicEdge', () => {
    it('splits a cubic arc at the given t parameter', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            makePoint(0, 0),
            {
              type: 'arc-cubic',
              point: new SheetPosition(10, 0),
              controlPointA: new SheetPosition(3, -5),
              controlPointB: new SheetPosition(7, -5),
            },
          ],
          { closed: false, openAtIndex: 0, fillColor: null },
        ),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;
      store.addPointOnCubicEdge(polygonId, 0, 0.5);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(3);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[0].type,
      ).toBe('point');
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[1].type,
      ).toBe('arc-cubic');
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points[2].type,
      ).toBe('arc-cubic');
    });

    it('records the operation to history for undo', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            makePoint(0, 0),
            {
              type: 'arc-cubic',
              point: new SheetPosition(10, 0),
              controlPointA: new SheetPosition(3, -5),
              controlPointB: new SheetPosition(7, -5),
            },
          ],
          { closed: false, openAtIndex: 0, fillColor: null },
        ),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;
      store.addPointOnCubicEdge(polygonId, 0, 0.5);
      expect(historyManager.canUndo()).toBe(true);
    });

    it('can undo and redo the curve split', () => {
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            makePoint(0, 0),
            {
              type: 'arc-cubic',
              point: new SheetPosition(10, 0),
              controlPointA: new SheetPosition(3, -5),
              controlPointB: new SheetPosition(7, -5),
            },
          ],
          { closed: false, openAtIndex: 0, fillColor: null },
        ),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;
      store.addPointOnCubicEdge(polygonId, 0, 0.5);
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(3);

      historyManager.undo();
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(2);

      historyManager.redo();
      expect(
        PolygonComponent.get(store.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(3);
    });

    it('offsets locked-polygon constraint pointIndex when splitting a cubic edge', () => {
      // Polygon: p0(point), p1(arc-cubic to (10,0)), p2(point at (10,10))
      store.add(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            makePoint(0, 0),
            {
              type: 'arc-cubic',
              point: new SheetPosition(10, 0),
              controlPointA: new SheetPosition(3, -5),
              controlPointB: new SheetPosition(7, -5),
            },
            makePoint(10, 10),
          ],
          { closed: false, openAtIndex: 0, fillColor: null },
        ),
      );
      const polygonId = store.listWithComponent(PolygonComponent)[0].id;

      // Constraint referencing p2 (index 2) — should shift to index 3 after split
      store.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygonId, 2),
          ConstraintEndpoint.lockedToPolygon(polygonId, 0),
          Length.centimeters(10),
        ),
      );

      store.addPointOnCubicEdge(polygonId, 0, 0.5);

      const constraints = store.findConstraintsByGeometryId(polygonId);
      expect(constraints).toHaveLength(1);
      expect((constraints[0] as any).pointA.pointIndex).toBe(3); // was 2
      expect((constraints[0] as any).pointB.pointIndex).toBe(0); // unchanged
    });
  });

  describe('addRectangle', () => {
    it('adds rectangle to array', () => {
      const rectangle = store.add(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10), {
          fillColor: null,
          linkDimensions: false,
        }),
      );
      expect(store.listWithComponent(RectangleComponent)).toHaveLength(1);
      expect(store.listWithComponent(RectangleComponent)[0].id).toBe(rectangle.id);
      expect(
        RectangleComponent.get(store.listWithComponent(RectangleComponent)[0]).upperLeft,
      ).toEqual(new SheetPosition(0, 0));
      expect(
        RectangleComponent.get(store.listWithComponent(RectangleComponent)[0]).lowerRight,
      ).toEqual(new SheetPosition(10, 10));
    });

    it('generates a stable id for new rectangles', () => {
      const rect1 = store.add(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10), {
          fillColor: null,
          linkDimensions: false,
        }),
      );
      const rect2 = store.add(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(1, 1), new SheetPosition(11, 11), {
          fillColor: null,
          linkDimensions: false,
        }),
      );
      expect(rect1.id).not.toBe(rect2.id);
    });

    it('emits rectangleAdded event', () => {
      const events = subscribeToEvents(store, ['geometryAdded']);
      store.add(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10), {
          fillColor: null,
          linkDimensions: false,
        }),
      );
      expect(events.areThereBufferedEvents('geometryAdded')).toBe(true);
    });
  });

  describe('addEllipse', () => {
    it('adds ellipse to array', () => {
      const ellipse = store.add(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(5, 5), {
          radiusX: 5,
          radiusY: 3,
          fillColor: null,
          linkDimensions: false,
        }),
      );
      expect(store.listWithComponent(EllipseComponent)).toHaveLength(1);
      expect(store.listWithComponent(EllipseComponent)[0].id).toBe(ellipse.id);
      expect(EllipseComponent.get(store.listWithComponent(EllipseComponent)[0]).center).toEqual(
        new SheetPosition(5, 5),
      );
      expect(EllipseComponent.get(store.listWithComponent(EllipseComponent)[0]).radiusX).toBe(5);
      expect(EllipseComponent.get(store.listWithComponent(EllipseComponent)[0]).radiusY).toBe(3);
    });

    it('generates a stable id for new ellipses', () => {
      const ellipse1 = store.add(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(5, 5), {
          radiusX: 5,
          radiusY: 3,
          fillColor: null,
          linkDimensions: false,
        }),
      );
      const ellipse2 = store.add(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(10, 10), {
          radiusX: 5,
          radiusY: 3,
          fillColor: null,
          linkDimensions: false,
        }),
      );
      expect(ellipse1.id).not.toBe(ellipse2.id);
    });
  });

  describe('workingRectangle', () => {
    it('setWorkingRectangle sets working rectangle', () => {
      const wr = {
        firstPoint: new SheetPosition(0, 0),
        previewLowerRight: new SheetPosition(10, 10),
        isCenterMode: false,
      };
      store.setWorkingRectangle(wr);
      expect(store.workingRectangle).toEqual(wr);
    });

    it('clearWorkingRectangle clears working rectangle', () => {
      store.setWorkingRectangle({
        firstPoint: new SheetPosition(0, 0),
        previewLowerRight: new SheetPosition(10, 10),
        isCenterMode: false,
      });
      store.clearWorkingRectangle();
      expect(store.workingRectangle).toBeNull();
    });
  });

  describe('workingEllipse', () => {
    it('setWorkingEllipse sets working ellipse', () => {
      const we = {
        firstPoint: new SheetPosition(5, 5),
        previewPoint: new SheetPosition(10, 5),
        isCenterMode: false,
      };
      store.setWorkingEllipse(we);
      expect(store.workingEllipse).toEqual(we);
    });

    it('clearWorkingEllipse clears working ellipse', () => {
      store.setWorkingEllipse({
        firstPoint: new SheetPosition(5, 5),
        previewPoint: new SheetPosition(10, 5),
        isCenterMode: false,
      });
      store.clearWorkingEllipse();
      expect(store.workingEllipse).toBeNull();
    });
  });

  // -----------------------------------------------------------
  // Closed-polygon closing duplicate mirroring
  // -----------------------------------------------------------
  describe('reconstrain — closed-polygon closing duplicate', () => {
    it('syncs the closing duplicate with the first point after solver moves it', () => {
      // Create a closed triangle (3 distinct points + closing duplicate)
      const p0 = makePoint(0, 0);
      const p1 = makePoint(100, 0);
      const p2 = makePoint(50, 100);
      const polygon = store.add(
        ID_PREFIXES.polygon,
        Polygon.create([p0, p1, p2], { closed: true, openAtIndex: 0, fillColor: null }),
      );

      // Create a datum and a distance constraint to force p0 to move
      const datum = store.add(ID_PREFIXES.datum, Datum.create(new SheetPosition(0, 150)));
      const constraint = LinearConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
        ConstraintEndpoint.lockedToDatum(datum.id),
        Length.centimeters(10),
      );
      store.addConstraint(constraint);

      // Run reconstrain
      store.reconstrain('cm', []);

      // The closing duplicate should mirror the first point
      const afterData = PolygonComponent.get(
        store.getByIdWithComponent(polygon.id, PolygonComponent)!,
      );
      const points = afterData.points;
      if (afterData.closed && points.length > 1) {
        expect(points[points.length - 1].point.x).toBeCloseTo(points[0].point.x, 2);
        expect(points[points.length - 1].point.y).toBeCloseTo(points[0].point.y, 2);
      }
    });
  });

  // -----------------------------------------------------------
  // Iterative expansion — subset solve succeeds
  // -----------------------------------------------------------
  describe('reconstrain — subset solve succeeds', () => {
    it('solves a single violated constraint without throwing', () => {
      const rect = store.add(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      const datum = store.add(ID_PREFIXES.datum, Datum.create(new SheetPosition(10, 8)));
      const constraint = LinearConstraint.create(
        ConstraintEndpoint.lockedToRectangle(rect.id, 'upperRight'),
        ConstraintEndpoint.lockedToDatum(datum.id),
        Length.centimeters(3),
      );
      store.addConstraint(constraint);

      const preData = RectangleComponent.get(
        store.getByIdWithComponent(rect.id, RectangleComponent)!,
      );

      // reconstrain must complete without error
      expect(() => store.reconstrain('cm', [])).not.toThrow();

      const postData = RectangleComponent.get(
        store.getByIdWithComponent(rect.id, RectangleComponent)!,
      );
      const postUpperRight = new SheetPosition(postData.lowerRight.x, postData.upperLeft.y);
      // The constraint moved the geometry — distance should have changed from its starting value
      const startDy = Math.abs(0 - 8); // upperRight.y=0, datum.y=8
      const endDy = Math.abs(postUpperRight.y - 8);
      expect(endDy).not.toBeCloseTo(startDy, 2);

      // Verify the geometry was actually mutated in the store
      expect(postData.upperLeft.y).not.toBe(preData.upperLeft.y);
    });
  });

  // -----------------------------------------------------------
  // Iterative expansion — fallback to full solve
  // -----------------------------------------------------------
  describe('reconstrain — fallback to full solve', () => {
    it('resolves constraints between two overlapping rectangles without throwing', () => {
      const rectA = store.add(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      const rectB = store.add(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(5, 5), new SheetPosition(15, 15)),
      );
      const constraint = LinearConstraint.create(
        ConstraintEndpoint.lockedToRectangle(rectA.id, 'upperRight'),
        ConstraintEndpoint.lockedToRectangle(rectB.id, 'upperLeft'),
        Length.centimeters(3), // currently ~7cm apart diagonally
      );
      store.addConstraint(constraint);

      // Should complete without error
      expect(() => store.reconstrain('cm', [])).not.toThrow();

      const postAData = RectangleComponent.get(
        store.getByIdWithComponent(rectA.id, RectangleComponent)!,
      );
      const postBData = RectangleComponent.get(
        store.getByIdWithComponent(rectB.id, RectangleComponent)!,
      );
      // Both rectangles should still exist (not deleted)
      expect(postAData).toBeDefined();
      expect(postBData).toBeDefined();
    });
  });

  // -----------------------------------------------------------
  // History-aware reconstrain — undo restores pre-solve state
  // -----------------------------------------------------------
  describe('reconstrain — undo support', () => {
    it('restores pre-solve state after undo', () => {
      const rect = store.add(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
      );

      // Add a constraint that will make the solver change things
      const datum = store.add(ID_PREFIXES.datum, Datum.create(new SheetPosition(0, 200)));
      const constraint = LinearConstraint.create(
        ConstraintEndpoint.lockedToRectangle(rect.id, 'upperLeft'),
        ConstraintEndpoint.lockedToDatum(datum.id),
        Length.centimeters(3),
      );
      store.addConstraint(constraint);

      // Save pre-solve state
      const preData = RectangleComponent.get(
        store.getByIdWithComponent(rect.id, RectangleComponent)!,
      );

      // Run reconstrain
      store.reconstrain('cm', []);
      expect(historyManager.canUndo()).toBe(true);

      // Undo — geometry should revert to pre-solve state
      historyManager.undo();

      const afterUndo = RectangleComponent.get(
        store.getByIdWithComponent(rect.id, RectangleComponent)!,
      );
      expect(afterUndo.upperLeft.x).toBeCloseTo(preData.upperLeft.x, 2);
      expect(afterUndo.upperLeft.y).toBeCloseTo(preData.upperLeft.y, 2);
      expect(afterUndo.lowerRight.x).toBeCloseTo(preData.lowerRight.x, 2);
      expect(afterUndo.lowerRight.y).toBeCloseTo(preData.lowerRight.y, 2);

      // Redo — geometry should go back to post-solve state
      expect(historyManager.canRedo()).toBe(true);
      historyManager.redo();

      const afterRedo = RectangleComponent.get(
        store.getByIdWithComponent(rect.id, RectangleComponent)!,
      );
      // After redo, the constraint should have been re-applied (geometry
      // differs from the pre-solve state restored by undo).
      const beforeSolved =
        preData.upperLeft.x === afterUndo.upperLeft.x &&
        preData.upperLeft.y === afterUndo.upperLeft.y;
      const afterRedoChanged =
        afterRedo.upperLeft.x !== afterUndo.upperLeft.x ||
        afterRedo.upperLeft.y !== afterUndo.upperLeft.y;
      expect(beforeSolved).toBe(true);
      expect(afterRedoChanged).toBe(true);
    });
  });
});
