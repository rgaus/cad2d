import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  ColinearConstraint,
  ConstraintEndpoint,
  Ellipse,
  EllipseComponent,
  HorizontalConstraint,
  LinearConstraint,
  type PerpendicularConstraint,
  Polygon,
  PolygonComponent,
  type PolygonSegment,
  Rectangle,
  RectangleComponent,
  RenderOrderComponent,
  VerticalConstraint,
} from '@/lib/geometry';
import { GeometryStore, ID_PREFIXES } from '@/lib/geometry/GeometryStore';
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
    geometryStore.addDirect(
      makeRectangle({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 20),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(rectId);

    await actionsManager.execute('convert-to-polygon');

    expect(geometryStore.getByIdWithComponent(rectId, RectangleComponent)).toBeNull();
    expect(geometryStore.listWithComponent(PolygonComponent).length).toBe(1);

    const polygon = geometryStore.listWithComponent(PolygonComponent)[0];
    expect(geometryStore.constraints).toHaveLength(4);

    // rectangleToPolygon produces: [0]=UL, [1]=UR, [2]=LR, [3]=LL, [4]=UL(dup)
    // Constraints are: H(0,1), V(1,2), H(2,3), V(3,0)
    const expectedConstraints: Array<{
      type: 'horizontal' | 'vertical';
      pointA: number;
      pointB: number;
    }> = [
      { type: 'horizontal', pointA: 0, pointB: 1 },
      { type: 'vertical', pointA: 1, pointB: 2 },
      { type: 'horizontal', pointA: 2, pointB: 3 },
      { type: 'vertical', pointA: 3, pointB: 0 },
    ];
    for (let i = 0; i < 4; i += 1) {
      const c = geometryStore.constraints[i];
      expect(c.type).toStrictEqual(expectedConstraints[i].type);
      const pc = c as any;
      expect(pc.pointA.type).toStrictEqual('locked-polygon');
      expect(pc.pointA.pointIndex).toBe(expectedConstraints[i].pointA);
      expect(pc.pointA.id).toBe(polygon.id);
      expect(pc.pointB.type).toStrictEqual('locked-polygon');
      expect(pc.pointB.pointIndex).toBe(expectedConstraints[i].pointB);
      expect(pc.pointB.id).toBe(polygon.id);
    }
  });

  it('converts an ellipse to a polygon', async () => {
    const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
    geometryStore.addDirect(
      makeEllipse({
        id: ellipseId,
        center: new SheetPosition(0, 0),
        radiusX: 10,
        radiusY: 20,
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(ellipseId);

    await actionsManager.execute('convert-to-polygon');

    expect(geometryStore.getByIdWithComponent(ellipseId, EllipseComponent)).toBeNull();
    expect(geometryStore.listWithComponent(PolygonComponent).length).toBe(1);
  });

  it('updates selection to the new polygon', async () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addDirect(
      makeRectangle({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 20),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(rectId);

    await actionsManager.execute('convert-to-polygon');

    const selectedIds = selectionManager.getSelectedIds();
    expect(selectedIds).toHaveLength(1);
    expect(selectedIds[0]).not.toBe(rectId);
    expect(geometryStore.getByIdWithComponent(selectedIds[0], PolygonComponent)).not.toBeNull();
  });

  it('supports undo/redo for rectangle conversion', async () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addDirect(
      makeRectangle({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 20),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(rectId);

    await actionsManager.execute('convert-to-polygon');
    const polygonId = geometryStore.listWithComponent(PolygonComponent)[0].id;
    expect(geometryStore.getByIdWithComponent(rectId, RectangleComponent)).toBeNull();
    expect(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)).not.toBeNull();
    expect(geometryStore.constraints).toHaveLength(4);
    expect(
      geometryStore.constraints.every((c) => c.type === 'horizontal' || c.type === 'vertical'),
    ).toBe(true);

    historyManager.undo();
    expect(geometryStore.getByIdWithComponent(rectId, RectangleComponent)).not.toBeNull();
    expect(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)).toBeNull();
    expect(geometryStore.constraints).toHaveLength(0);

    historyManager.redo();
    expect(geometryStore.getByIdWithComponent(rectId, RectangleComponent)).toBeNull();
    expect(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)).not.toBeNull();
    expect(geometryStore.constraints).toHaveLength(4);
    expect(
      geometryStore.constraints.every((c) => c.type === 'horizontal' || c.type === 'vertical'),
    ).toBe(true);
  });

  it('supports undo/redo for ellipse conversion', async () => {
    const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
    geometryStore.addDirect(
      makeEllipse({
        id: ellipseId,
        center: new SheetPosition(0, 0),
        radiusX: 10,
        radiusY: 20,
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(ellipseId);

    await actionsManager.execute('convert-to-polygon');
    const polygonId = geometryStore.listWithComponent(PolygonComponent)[0].id;
    expect(geometryStore.getByIdWithComponent(ellipseId, EllipseComponent)).toBeNull();
    expect(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)).not.toBeNull();

    historyManager.undo();
    expect(geometryStore.getByIdWithComponent(ellipseId, EllipseComponent)).not.toBeNull();
    expect(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)).toBeNull();

    historyManager.redo();
    expect(geometryStore.getByIdWithComponent(ellipseId, EllipseComponent)).toBeNull();
    expect(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)).not.toBeNull();
  });

  it('is disabled when nothing is selected', () => {
    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(true);
  });

  it('is disabled when a polygon is selected', () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    geometryStore.addDirect(
      makePolygon({
        id: polygonId,
        points: makeClosedPolygonPoints(),
        closed: true,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
      }),
    );
    selectionManager.select(polygonId);

    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(true);
  });

  it('is enabled when exactly one rectangle is selected', () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addDirect(
      makeRectangle({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 20),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(rectId);

    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(false);
  });

  it('is enabled when exactly one ellipse is selected', () => {
    const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
    geometryStore.addDirect(
      makeEllipse({
        id: ellipseId,
        center: new SheetPosition(0, 0),
        radiusX: 10,
        radiusY: 20,
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(ellipseId);

    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(false);
  });

  describe('constraint preservation', () => {
    it('relinks locked-rectangle endpoints to locked-polygon after rectangle conversion', async () => {
      const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addDirect(
        makeRectangle({
          id: rectId,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 20),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

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

      const polygon = geometryStore.listWithComponent(PolygonComponent)[0];
      expect(updatedConstraint!.pointA).toEqual({
        type: 'locked-polygon',
        id: polygon.id,
        pointIndex: 0,
      });
      expect(updatedConstraint!.pointB).toEqual({
        type: 'point',
        point: new SheetPosition(30, 30),
      });
    });

    it('relinks all rectangle key point endpoints to the correct polygon indices', async () => {
      const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addDirect(
        makeRectangle({
          id: rectId,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 20),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      // Create constraints locked to each of the four rectangle corner key points
      const cUpperLeft = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'upperLeft'),
          ConstraintEndpoint.point(new SheetPosition(5, 5)),
          Length.centimeters(3),
        ),
      );
      const cUpperRight = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'upperRight'),
          ConstraintEndpoint.point(new SheetPosition(5, 5)),
          Length.centimeters(3),
        ),
      );
      const cLowerRight = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'lowerRight'),
          ConstraintEndpoint.point(new SheetPosition(5, 5)),
          Length.centimeters(3),
        ),
      );
      const cLowerLeft = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'lowerLeft'),
          ConstraintEndpoint.point(new SheetPosition(5, 5)),
          Length.centimeters(3),
        ),
      );

      selectionManager.select(rectId);
      await actionsManager.execute('convert-to-polygon');

      const polygon = geometryStore.listWithComponent(PolygonComponent)[0];

      // rectangleToPolygon: [0]=UL, [1]=UR, [2]=LR, [3]=LL, [4]=UL(dup)
      const c1 = geometryStore.getConstraintById(cUpperLeft.id)!;
      expect(c1.pointA).toEqual({
        type: 'locked-polygon',
        id: polygon.id,
        pointIndex: 0,
      });

      const c2 = geometryStore.getConstraintById(cUpperRight.id)!;
      expect(c2.pointA).toEqual({
        type: 'locked-polygon',
        id: polygon.id,
        pointIndex: 1,
      });

      const c3 = geometryStore.getConstraintById(cLowerRight.id)!;
      expect(c3.pointA).toEqual({
        type: 'locked-polygon',
        id: polygon.id,
        pointIndex: 2,
      });

      const c4 = geometryStore.getConstraintById(cLowerLeft.id)!;
      expect(c4.pointA).toEqual({
        type: 'locked-polygon',
        id: polygon.id,
        pointIndex: 3,
      });
    });

    it('converts rectangle center endpoint to a free point', async () => {
      const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addDirect(
        makeRectangle({
          id: rectId,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 20),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'center'),
          ConstraintEndpoint.point(new SheetPosition(30, 30)),
          Length.centimeters(5),
        ),
      );

      selectionManager.select(rectId);
      await actionsManager.execute('convert-to-polygon');

      const updatedConstraint = geometryStore.getConstraintById(constraint.id);
      expect(updatedConstraint).not.toBeNull();
      expect(updatedConstraint!.pointA).toEqual({
        type: 'point',
        point: new SheetPosition(5, 10),
      });
    });

    it('relinks locked-ellipse perimeter endpoints to locked-polygon', async () => {
      const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
      geometryStore.addDirect(
        makeEllipse({
          id: ellipseId,
          center: new SheetPosition(0, 0),
          radiusX: 10,
          radiusY: 20,
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

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

      const polygon = geometryStore.listWithComponent(PolygonComponent)[0];
      // ellipseToPolygon: [0]=top, [1]=right, [2]=bottom, [3]=left, [4]=top(dup)
      expect(updatedConstraint!.pointA).toEqual({
        type: 'locked-polygon',
        id: polygon.id,
        pointIndex: 0,
      });
      expect(updatedConstraint!.pointB).toEqual({
        type: 'locked-polygon',
        id: polygon.id,
        pointIndex: 1,
      });
    });

    it('converts ellipse center endpoint to a free point', async () => {
      const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
      geometryStore.addDirect(
        makeEllipse({
          id: ellipseId,
          center: new SheetPosition(15, 25),
          radiusX: 10,
          radiusY: 20,
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

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
    });

    it('constraint is resolvable after rectangle conversion', async () => {
      const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addDirect(
        makeRectangle({
          id: rectId,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 20),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'upperLeft'),
          ConstraintEndpoint.lockedToRectangle(rectId, 'lowerRight'),
          Length.centimeters(5),
        ),
      );

      expect(geometryStore.resolveConstraintEndpoint(constraint.pointA)).toEqual(
        new SheetPosition(0, 0),
      );
      expect(geometryStore.resolveConstraintEndpoint(constraint.pointB)).toEqual(
        new SheetPosition(10, 20),
      );

      selectionManager.select(rectId);
      await actionsManager.execute('convert-to-polygon');

      const updatedConstraint = geometryStore.getConstraintById(constraint.id)!;
      expect(geometryStore.resolveConstraintEndpoint(updatedConstraint.pointA)).toEqual(
        new SheetPosition(0, 0),
      );
      expect(geometryStore.resolveConstraintEndpoint(updatedConstraint.pointB)).toEqual(
        new SheetPosition(10, 20),
      );
    });

    it('constraint is resolvable after ellipse conversion', async () => {
      const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
      geometryStore.addDirect(
        makeEllipse({
          id: ellipseId,
          center: new SheetPosition(0, 0),
          radiusX: 10,
          radiusY: 20,
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToEllipse(ellipseId, 'top'),
          ConstraintEndpoint.lockedToEllipse(ellipseId, 'right'),
          Length.centimeters(3),
        ),
      );

      selectionManager.select(ellipseId);
      await actionsManager.execute('convert-to-polygon');

      const updatedConstraint = geometryStore.getConstraintById(constraint.id)!;
      const afterA = geometryStore.resolveConstraintEndpoint(updatedConstraint.pointA);
      expect(afterA).toEqual(new SheetPosition(0, -20));
      const afterB = geometryStore.resolveConstraintEndpoint(updatedConstraint.pointB);
      expect(afterB).toEqual(new SheetPosition(10, 0));
    });

    it('undo restores original locked-rectangle endpoint', async () => {
      const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addDirect(
        makeRectangle({
          id: rectId,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 20),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'upperLeft'),
          ConstraintEndpoint.point(new SheetPosition(30, 30)),
          Length.centimeters(5),
        ),
      );

      const originalPointA = constraint.pointA;

      selectionManager.select(rectId);
      await actionsManager.execute('convert-to-polygon');

      historyManager.undo();

      const restoredConstraint = geometryStore.getConstraintById(constraint.id)!;
      expect(restoredConstraint.pointA).toEqual(originalPointA);
      expect(geometryStore.getByIdWithComponent(rectId, RectangleComponent)).not.toBeNull();
    });

    it('undo restores original locked-ellipse endpoint', async () => {
      const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
      geometryStore.addDirect(
        makeEllipse({
          id: ellipseId,
          center: new SheetPosition(0, 0),
          radiusX: 10,
          radiusY: 20,
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToEllipse(ellipseId, 'top'),
          ConstraintEndpoint.point(new SheetPosition(30, 30)),
          Length.centimeters(5),
        ),
      );

      const originalPointA = constraint.pointA;

      selectionManager.select(ellipseId);
      await actionsManager.execute('convert-to-polygon');

      historyManager.undo();

      const restoredConstraint = geometryStore.getConstraintById(constraint.id)!;
      expect(restoredConstraint.pointA).toEqual(originalPointA);
      expect(geometryStore.getByIdWithComponent(ellipseId, EllipseComponent)).not.toBeNull();
    });

    it('redo re-applies constraint relinking after undo', async () => {
      const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addDirect(
        makeRectangle({
          id: rectId,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 20),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'upperLeft'),
          ConstraintEndpoint.point(new SheetPosition(30, 30)),
          Length.centimeters(5),
        ),
      );

      selectionManager.select(rectId);
      await actionsManager.execute('convert-to-polygon');
      const polygonId = geometryStore.listWithComponent(PolygonComponent)[0].id;

      historyManager.undo();
      historyManager.redo();

      const redoneConstraint = geometryStore.getConstraintById(constraint.id)!;
      expect(redoneConstraint.pointA).toEqual({
        type: 'locked-polygon',
        id: polygonId,
        pointIndex: 0,
      });
    });

    it('does not modify endpoints that do not reference the converted shape', async () => {
      const rectId1 = historyManager.generateStableId(ID_PREFIXES.rectangle);
      const rectId2 = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addDirect(
        makeRectangle({
          id: rectId1,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 20),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );
      geometryStore.addDirect(
        makeRectangle({
          id: rectId2,
          upperLeft: new SheetPosition(50, 50),
          lowerRight: new SheetPosition(60, 70),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      const constraint = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId1, 'upperLeft'),
          ConstraintEndpoint.lockedToRectangle(rectId2, 'upperLeft'),
          Length.centimeters(5),
        ),
      );

      selectionManager.select(rectId1);
      await actionsManager.execute('convert-to-polygon');

      const updatedConstraint = geometryStore.getConstraintById(constraint.id)!;
      const polygon = geometryStore.listWithComponent(PolygonComponent)[0];
      // rectId1's endpoint should be relinked
      expect(updatedConstraint.pointA).toEqual({
        type: 'locked-polygon',
        id: polygon.id,
        pointIndex: 0,
      });
      // rectId2's endpoint should remain unchanged (it was not the converted shape)
      expect(updatedConstraint.pointB).toEqual({
        type: 'locked-rectangle',
        id: rectId2,
        point: 'upperLeft',
      });
    });

    it('preserves multiple constraints on the same rectangle', async () => {
      const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addDirect(
        makeRectangle({
          id: rectId,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 20),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      const c1 = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'upperLeft'),
          ConstraintEndpoint.point(new SheetPosition(5, 5)),
          Length.centimeters(3),
        ),
      );
      const c2 = geometryStore.addConstraint(
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'lowerRight'),
          ConstraintEndpoint.point(new SheetPosition(5, 5)),
          Length.centimeters(3),
        ),
      );

      selectionManager.select(rectId);
      await actionsManager.execute('convert-to-polygon');

      expect(geometryStore.getConstraintById(c1.id)).not.toBeNull();
      expect(geometryStore.getConstraintById(c2.id)).not.toBeNull();

      const polygon = geometryStore.listWithComponent(PolygonComponent)[0];
      // Plus 4 H/V constraints = 6 total
      expect(geometryStore.constraints).toHaveLength(6);
    });

    it('preserves horizontal constraints during rectangle conversion', async () => {
      const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addDirect(
        makeRectangle({
          id: rectId,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 20),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      const constraint = geometryStore.addConstraint(
        HorizontalConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'upperLeft'),
          ConstraintEndpoint.lockedToRectangle(rectId, 'upperRight'),
        ),
      );

      selectionManager.select(rectId);
      await actionsManager.execute('convert-to-polygon');

      const updated = geometryStore.getConstraintById(constraint.id);
      expect(updated).not.toBeNull();
      const polygon = geometryStore.listWithComponent(PolygonComponent)[0];
      expect(updated!.pointA).toEqual({
        type: 'locked-polygon',
        id: polygon.id,
        pointIndex: 0,
      });
      expect(updated!.pointB).toEqual({
        type: 'locked-polygon',
        id: polygon.id,
        pointIndex: 1,
      });
    });

    it('preserves vertical constraints during rectangle conversion', async () => {
      const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
      geometryStore.addDirect(
        makeRectangle({
          id: rectId,
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 20),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      const constraint = geometryStore.addConstraint(
        VerticalConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectId, 'upperRight'),
          ConstraintEndpoint.lockedToRectangle(rectId, 'lowerRight'),
        ),
      );

      selectionManager.select(rectId);
      await actionsManager.execute('convert-to-polygon');

      const updated = geometryStore.getConstraintById(constraint.id);
      expect(updated).not.toBeNull();
    });
  });
});
