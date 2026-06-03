import { ActionsManager } from '@/lib/actions/ActionsManager';
import { type PolygonSegment } from '@/lib/geometry';
import { GeometryStore, ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import {
  ConstraintEndpoint,
  LinearConstraint,
  relinkEllipseEndpoint,
  relinkRectangleEndpoint,
} from '@/lib/geometry/constraints';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

function makeClosedPolygonPoints(): Array<PolygonSegment> {
  return [
    { type: 'point' as const, point: new SheetPosition(0, 0) },
    { type: 'point' as const, point: new SheetPosition(10, 0) },
    { type: 'point' as const, point: new SheetPosition(10, 10) },
    { type: 'point' as const, point: new SheetPosition(0, 0) },
  ];
}

describe('ConvertToPolygonAction', () => {
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

  it('converts a rectangle to a polygon', async () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addRectangleDirect({
      id: rectId,
      upperLeft: new SheetPosition(0, 0),
      lowerRight: new SheetPosition(10, 20),
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(rectId);

    await actionsManager.execute('convert-to-polygon');

    expect(geometryStore.getRectangleById(rectId)).toBeNull();
    expect(geometryStore.polygons.length).toBe(1);
  });

  it('converts an ellipse to a polygon', async () => {
    const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
    geometryStore.addEllipseDirect({
      id: ellipseId,
      center: new SheetPosition(0, 0),
      radiusX: 10,
      radiusY: 20,
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(ellipseId);

    await actionsManager.execute('convert-to-polygon');

    expect(geometryStore.getEllipseById(ellipseId)).toBeNull();
    expect(geometryStore.polygons.length).toBe(1);
  });

  it('updates selection to the new polygon', async () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addRectangleDirect({
      id: rectId,
      upperLeft: new SheetPosition(0, 0),
      lowerRight: new SheetPosition(10, 20),
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(rectId);

    await actionsManager.execute('convert-to-polygon');

    const selectedIds = selectionManager.getSelectedIds();
    expect(selectedIds).toHaveLength(1);
    expect(selectedIds[0]).not.toBe(rectId);
    expect(geometryStore.getPolygonById(selectedIds[0])).not.toBeNull();
  });

  it('supports undo/redo for rectangle conversion', async () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addRectangleDirect({
      id: rectId,
      upperLeft: new SheetPosition(0, 0),
      lowerRight: new SheetPosition(10, 20),
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(rectId);

    await actionsManager.execute('convert-to-polygon');
    const polygonId = geometryStore.polygons[0].id;
    expect(geometryStore.getRectangleById(rectId)).toBeNull();
    expect(geometryStore.getPolygonById(polygonId)).not.toBeNull();

    historyManager.undo();
    expect(geometryStore.getRectangleById(rectId)).not.toBeNull();
    expect(geometryStore.getPolygonById(polygonId)).toBeNull();

    historyManager.redo();
    expect(geometryStore.getRectangleById(rectId)).toBeNull();
    expect(geometryStore.getPolygonById(polygonId)).not.toBeNull();
  });

  it('supports undo/redo for ellipse conversion', async () => {
    const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
    geometryStore.addEllipseDirect({
      id: ellipseId,
      center: new SheetPosition(0, 0),
      radiusX: 10,
      radiusY: 20,
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(ellipseId);

    await actionsManager.execute('convert-to-polygon');
    const polygonId = geometryStore.polygons[0].id;
    expect(geometryStore.getEllipseById(ellipseId)).toBeNull();
    expect(geometryStore.getPolygonById(polygonId)).not.toBeNull();

    historyManager.undo();
    expect(geometryStore.getEllipseById(ellipseId)).not.toBeNull();
    expect(geometryStore.getPolygonById(polygonId)).toBeNull();

    historyManager.redo();
    expect(geometryStore.getEllipseById(ellipseId)).toBeNull();
    expect(geometryStore.getPolygonById(polygonId)).not.toBeNull();
  });

  it('is disabled when nothing is selected', () => {
    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(true);
  });

  it('is disabled when a polygon is selected', () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    geometryStore.addPolygonDirect({
      id: polygonId,
      points: makeClosedPolygonPoints(),
      closed: true,
      fillColor: null,
      openAtIndex: 0,
      renderOrder: 0,
    });
    selectionManager.select(polygonId);

    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(true);
  });

  it('is enabled when exactly one rectangle is selected', () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addRectangleDirect({
      id: rectId,
      upperLeft: new SheetPosition(0, 0),
      lowerRight: new SheetPosition(10, 20),
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(rectId);

    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(false);
  });

  it('is enabled when exactly one ellipse is selected', () => {
    const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
    geometryStore.addEllipseDirect({
      id: ellipseId,
      center: new SheetPosition(0, 0),
      radiusX: 10,
      radiusY: 20,
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(ellipseId);

    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(false);
  });

  describe('constraint preservation', () => {
    it('relinks a locked-rectangle endpoint to locked-polygon after conversion', async () => {
      const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addRectangleDirect({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 20),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      });

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'upperLeft'),
          ConstraintEndpoint.point(new SheetPosition(30, 30)),
          Length.centimeters(5),
        ),
      );

      selectionManager.select(rectId);
      await actionsManager.execute('convert-to-polygon');

      const updatedConstraint = geometryStore.getConstraintById(constraint.id);
      expect(updatedConstraint).not.toBeNull();

      expect(updatedConstraint!.pointA).toEqual({
        type: 'locked-polygon',
        id: geometryStore.polygons[0].id,
        pointIndex: 0,
      });
      expect(updatedConstraint!.pointB).toEqual({
        type: 'point',
        point: new SheetPosition(30, 30),
      });
    });

    it('relinks a locked-ellipse endpoint to locked-polygon after conversion', async () => {
      const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
      geometryStore.addEllipseDirect({
        id: ellipseId,
        center: new SheetPosition(0, 0),
        radiusX: 10,
        radiusY: 20,
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      });

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToEllipse(ellipseId, 'top'),
          ConstraintEndpoint.lockedToEllipse(ellipseId, 'right'),
          Length.centimeters(3),
        ),
      );

      selectionManager.select(ellipseId);
      await actionsManager.execute('convert-to-polygon');

      const updatedConstraint = geometryStore.getConstraintById(constraint.id);
      expect(updatedConstraint).not.toBeNull();

      expect(updatedConstraint!.pointA).toEqual({
        type: 'locked-polygon',
        id: geometryStore.polygons[0].id,
        pointIndex: 1,
      });
      expect(updatedConstraint!.pointB).toEqual({
        type: 'locked-polygon',
        id: geometryStore.polygons[0].id,
        pointIndex: 0,
      });
    });

    it('converts a locked-ellipse center endpoint to a point endpoint', async () => {
      const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
      geometryStore.addEllipseDirect({
        id: ellipseId,
        center: new SheetPosition(15, 25),
        radiusX: 10,
        radiusY: 20,
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      });

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToEllipse(ellipseId, 'center'),
          ConstraintEndpoint.lockedToEllipse(ellipseId, 'top'),
          Length.centimeters(4),
        ),
      );

      selectionManager.select(ellipseId);
      await actionsManager.execute('convert-to-polygon');

      const updatedConstraint = geometryStore.getConstraintById(constraint.id);
      expect(updatedConstraint).not.toBeNull();

      expect(updatedConstraint!.pointA).toEqual({
        type: 'point',
        point: new SheetPosition(15, 25),
      });
      expect(updatedConstraint!.pointB).toEqual({
        type: 'locked-polygon',
        id: geometryStore.polygons[0].id,
        pointIndex: 1,
      });
    });

    it('constraint remains resolvable after rectangle conversion', async () => {
      const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addRectangleDirect({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 20),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      });

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'upperLeft'),
          ConstraintEndpoint.lockedToRectangle(rectId, 'lowerRight'),
          Length.centimeters(5),
        ),
      );

      // Verify resolvable before conversion
      const beforeA = geometryStore.resolveConstraintEndpoint(constraint.pointA);
      expect(beforeA).toEqual(new SheetPosition(0, 0));
      const beforeB = geometryStore.resolveConstraintEndpoint(constraint.pointB);
      expect(beforeB).toEqual(new SheetPosition(10, 20));

      selectionManager.select(rectId);
      await actionsManager.execute('convert-to-polygon');

      const updatedConstraint = geometryStore.getConstraintById(constraint.id);
      expect(updatedConstraint).not.toBeNull();

      // Verify resolvable after conversion
      const afterA = geometryStore.resolveConstraintEndpoint(updatedConstraint!.pointA);
      expect(afterA).toEqual(new SheetPosition(0, 0));
      const afterB = geometryStore.resolveConstraintEndpoint(updatedConstraint!.pointB);
      expect(afterB).toEqual(new SheetPosition(10, 20));
    });

    it('constraint remains resolvable after ellipse conversion', async () => {
      const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
      geometryStore.addEllipseDirect({
        id: ellipseId,
        center: new SheetPosition(0, 0),
        radiusX: 10,
        radiusY: 20,
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      });

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToEllipse(ellipseId, 'top'),
          ConstraintEndpoint.lockedToEllipse(ellipseId, 'right'),
          Length.centimeters(3),
        ),
      );

      selectionManager.select(ellipseId);
      await actionsManager.execute('convert-to-polygon');

      const updatedConstraint = geometryStore.getConstraintById(constraint.id);
      expect(updatedConstraint).not.toBeNull();

      const afterA = geometryStore.resolveConstraintEndpoint(updatedConstraint!.pointA);
      expect(afterA).toEqual(new SheetPosition(0, -20));
      const afterB = geometryStore.resolveConstraintEndpoint(updatedConstraint!.pointB);
      expect(afterB).toEqual(new SheetPosition(10, 0));
    });

    it('restores original locked-rectangle endpoint on undo', async () => {
      const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addRectangleDirect({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 20),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      });

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'upperLeft'),
          ConstraintEndpoint.point(new SheetPosition(30, 30)),
          Length.centimeters(5),
        ),
      );

      const beforeUndoPointA = constraint.pointA;

      selectionManager.select(rectId);
      await actionsManager.execute('convert-to-polygon');

      historyManager.undo();

      const restoredConstraint = geometryStore.getConstraintById(constraint.id);
      expect(restoredConstraint).not.toBeNull();
      expect(restoredConstraint!.pointA).toEqual(beforeUndoPointA);
    });

    it('restores original locked-ellipse endpoint on undo', async () => {
      const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
      geometryStore.addEllipseDirect({
        id: ellipseId,
        center: new SheetPosition(0, 0),
        radiusX: 10,
        radiusY: 20,
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      });

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToEllipse(ellipseId, 'top'),
          ConstraintEndpoint.point(new SheetPosition(30, 30)),
          Length.centimeters(5),
        ),
      );

      const beforeUndoPointA = constraint.pointA;

      selectionManager.select(ellipseId);
      await actionsManager.execute('convert-to-polygon');

      historyManager.undo();

      const restoredConstraint = geometryStore.getConstraintById(constraint.id);
      expect(restoredConstraint).not.toBeNull();
      expect(restoredConstraint!.pointA).toEqual(beforeUndoPointA);
    });

    it('relinks rectangle endpoint helper maps correctly', () => {
      const oldId = 'rect1';
      const newId = 'poly1';

      const upperLeft = ConstraintEndpoint.lockedToRectangle(oldId, 'upperLeft');
      expect(relinkRectangleEndpoint(upperLeft, oldId, newId)).toEqual({
        type: 'locked-polygon',
        id: newId,
        pointIndex: 0,
      });

      const upperRight = ConstraintEndpoint.lockedToRectangle(oldId, 'upperRight');
      expect(relinkRectangleEndpoint(upperRight, oldId, newId)).toEqual({
        type: 'locked-polygon',
        id: newId,
        pointIndex: 1,
      });

      const lowerRight = ConstraintEndpoint.lockedToRectangle(oldId, 'lowerRight');
      expect(relinkRectangleEndpoint(lowerRight, oldId, newId)).toEqual({
        type: 'locked-polygon',
        id: newId,
        pointIndex: 2,
      });

      const lowerLeft = ConstraintEndpoint.lockedToRectangle(oldId, 'lowerLeft');
      expect(relinkRectangleEndpoint(lowerLeft, oldId, newId)).toEqual({
        type: 'locked-polygon',
        id: newId,
        pointIndex: 3,
      });
    });

    it('relinks ellipse endpoint helper maps correctly', () => {
      const oldId = 'ell1';
      const newId = 'poly1';
      const center = new SheetPosition(10, 20);

      const right = ConstraintEndpoint.lockedToEllipse(oldId, 'right');
      expect(relinkEllipseEndpoint(right, oldId, newId, center)).toEqual({
        type: 'locked-polygon',
        id: newId,
        pointIndex: 0,
      });

      const top = ConstraintEndpoint.lockedToEllipse(oldId, 'top');
      expect(relinkEllipseEndpoint(top, oldId, newId, center)).toEqual({
        type: 'locked-polygon',
        id: newId,
        pointIndex: 1,
      });

      const left = ConstraintEndpoint.lockedToEllipse(oldId, 'left');
      expect(relinkEllipseEndpoint(left, oldId, newId, center)).toEqual({
        type: 'locked-polygon',
        id: newId,
        pointIndex: 2,
      });

      const bottom = ConstraintEndpoint.lockedToEllipse(oldId, 'bottom');
      expect(relinkEllipseEndpoint(bottom, oldId, newId, center)).toEqual({
        type: 'locked-polygon',
        id: newId,
        pointIndex: 3,
      });
    });

    it('relinks ellipse center endpoint to point type', () => {
      const oldId = 'ell1';
      const newId = 'poly1';
      const center = new SheetPosition(42, 99);

      const centerEndpoint = ConstraintEndpoint.lockedToEllipse(oldId, 'center');
      expect(relinkEllipseEndpoint(centerEndpoint, oldId, newId, center)).toEqual({
        type: 'point',
        point: center,
      });
    });

    it('does not modify non-matching endpoints', () => {
      const pointEndpoint: ConstraintEndpoint = { type: 'point', point: new SheetPosition(1, 2) };
      expect(relinkRectangleEndpoint(pointEndpoint, 'other', 'new')).toBe(pointEndpoint);
      expect(relinkEllipseEndpoint(pointEndpoint, 'other', 'new', new SheetPosition(3, 4))).toBe(
        pointEndpoint,
      );

      const polyEndpoint: ConstraintEndpoint = {
        type: 'locked-polygon',
        id: 'poly',
        pointIndex: 0,
      };
      expect(relinkRectangleEndpoint(polyEndpoint, 'other', 'new')).toBe(polyEndpoint);
      expect(relinkEllipseEndpoint(polyEndpoint, 'other', 'new', new SheetPosition(3, 4))).toBe(
        polyEndpoint,
      );
    });
  });
});
