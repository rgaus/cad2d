import { applyToPoint, inverse } from 'transformation-matrix';
import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  ConstraintEndpoint,
  Entity,
  FillColorComponent,
  GeometryComponent,
  LinearConstraint,
  Polygon,
  Rectangle,
  type ResizeMode,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { RectangleData } from '@/lib/entity/geometry/rectangle';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { OrientedBoundingBox, rotatePointAround } from '@/lib/math';
import {
  computeResizePointerOutset,
  computeSelectionResizeFrame,
} from '@/lib/selection/resize-frame';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { SHEET_UNITS_TO_PIXELS, Sheet } from '@/lib/sheet/Sheet';
import { SELECTED_OUTSET_PX, SelectTool } from '@/lib/tools/SelectTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { Angle } from '@/lib/units/angle';
import { Length } from '@/lib/units/length';
import { ViewportControls } from '@/lib/viewport/ViewportControls';
import { GeometryRelativeSheetPosition } from '@/lib/viewport/types';
import { ScreenPosition, SheetPosition } from '@/lib/viewport/types';

function point(x: number, y: number) {
  return { type: 'point' as const, point: new SheetPosition(x, y) };
}

describe('SelectTool rotation-aware interactions', () => {
  let geometryStore: GeometryStore;
  let toolManager: ToolManager;
  let selectionManager: SelectionManager;
  let historyManager: HistoryManager;
  let selectTool: SelectTool;
  let viewportControls: ViewportControls;
  let moveHandler: ((event: MouseEvent) => void) | undefined;
  let upHandler: ((event: MouseEvent) => void) | undefined;
  let addEventListenerSpy: jest.SpyInstance;
  let removeEventListenerSpy: jest.SpyInstance;

  beforeEach(() => {
    const sheet = Sheet.a4();
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    const actionsManager = new ActionsManager(
      sheet,
      geometryStore,
      selectionManager,
      historyManager,
    );
    const serializationManager = new SerializationManager(actionsManager, toolManager, sheet);
    toolManager.setSerializationManager(serializationManager);
    selectTool = toolManager.getTool('select') as SelectTool;
    viewportControls = new ViewportControls({
      canvasWidth: 800,
      canvasHeight: 600,
      sheet,
    });

    moveHandler = undefined;
    upHandler = undefined;
    addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    removeEventListenerSpy = jest.spyOn(window, 'removeEventListener').mockImplementation(() => {});
    addEventListenerSpy.mockImplementation(
      (event: string, handler: (event: MouseEvent) => void) => {
        if (event === 'mousemove') moveHandler = handler;
        if (event === 'mouseup') upHandler = handler;
      },
    );
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
    jest.restoreAllMocks();
  });

  function renderPoint(geometry: Entity<GeometryComponent>, raw: SheetPosition): SheetPosition {
    return Entity.generateRenderTransformFunction(geometry)(raw);
  }

  function rawPointFromRendered(
    geometry: Entity<GeometryComponent>,
    rendered: SheetPosition,
  ): SheetPosition {
    const raw = applyToPoint(inverse(Entity.generateRenderMatrix(geometry)), rendered);
    return new SheetPosition(raw.x, raw.y);
  }

  function renderedCorners(geometry: Entity<GeometryComponent>) {
    const raw = RectangleData.corners(GeometryComponent.get(geometry) as RectangleData);
    return {
      upperLeft: renderPoint(geometry, raw.upperLeft),
      upperRight: renderPoint(geometry, raw.upperRight),
      lowerLeft: renderPoint(geometry, raw.lowerLeft),
      lowerRight: renderPoint(geometry, raw.lowerRight),
    };
  }

  function setRotation(id: string, angleDegrees: number) {
    geometryStore.updateById(id, (g) => ({
      ...g,
      components: {
        ...g.components,
        ...RotationComponent.create(Angle.degrees(angleDegrees)),
      },
    }));
  }

  function addRotatedRectangle(
    upperLeft: SheetPosition,
    lowerRight: SheetPosition,
    angleDegrees: number,
  ) {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(upperLeft, lowerRight),
    );
    setRotation(rectangle.id, angleDegrees);
    return geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;
  }

  function moveTo(screen: ScreenPosition) {
    moveHandler!({ clientX: screen.x, clientY: screen.y } as MouseEvent);
  }

  function commitAt(screen: ScreenPosition) {
    upHandler!({ clientX: screen.x, clientY: screen.y } as MouseEvent);
  }

  function startResize(
    geometryIds: Array<string>,
    mode: ResizeMode,
    targetRendered: SheetPosition,
  ) {
    const frame = computeSelectionResizeFrame(geometryIds.map((id) => geometryStore.getById(id)!))!;
    const outset = computeResizePointerOutset(mode, frame.bbox.angleDegrees, SELECTED_OUTSET_PX);
    const targetScreen = targetRendered.toScreen(viewportControls.getState().viewport);
    const client = new ScreenPosition(targetScreen.x - outset.x, targetScreen.y - outset.y);
    selectTool.onGeometryResizePointerDown(viewportControls, geometryIds, mode);
    moveTo(client);
    return client;
  }

  describe('rotated resize', () => {
    it('resizes a rotated rectangle corner in its local frame and pins the opposite corner', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const rectangle = addRotatedRectangle(
        new SheetPosition(10, 10),
        new SheetPosition(14, 12),
        30,
      );
      const beforeCorners = renderedCorners(rectangle);

      const targetRaw = new SheetPosition(20, 8);
      const targetRendered = renderPoint(rectangle, targetRaw);
      const client = startResize(
        [rectangle.id],
        { type: 'corner', corner: 'top-right' },
        targetRendered,
      );
      commitAt(client);

      const after = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;
      const afterCorners = renderedCorners(after);

      expect(
        RotationComponent.get(
          geometryStore.getByIdWithComponent(rectangle.id, RotationComponent)!,
        ).angle.toDegrees().magnitude,
      ).toBeCloseTo(30);
      expect(afterCorners.lowerLeft.x).toBeCloseTo(beforeCorners.lowerLeft.x, 6);
      expect(afterCorners.lowerLeft.y).toBeCloseTo(beforeCorners.lowerLeft.y, 6);
      expect(afterCorners.upperRight.x).toBeCloseTo(targetRendered.x, 6);
      expect(afterCorners.upperRight.y).toBeCloseTo(targetRendered.y, 6);
      ctrlSpy.mockRestore();
    });

    it('resizes a rotated rectangle edge along local axes and pins the opposite edge', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const rectangle = addRotatedRectangle(
        new SheetPosition(10, 10),
        new SheetPosition(14, 12),
        30,
      );
      const beforeCorners = renderedCorners(rectangle);

      const targetRendered = renderPoint(rectangle, new SheetPosition(20, 11));
      const client = startResize([rectangle.id], { type: 'edge', edge: 'right' }, targetRendered);
      commitAt(client);

      const after = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;
      const afterCorners = renderedCorners(after);

      expect(afterCorners.upperLeft.x).toBeCloseTo(beforeCorners.upperLeft.x, 6);
      expect(afterCorners.upperLeft.y).toBeCloseTo(beforeCorners.upperLeft.y, 6);
      expect(afterCorners.lowerLeft.x).toBeCloseTo(beforeCorners.lowerLeft.x, 6);
      expect(afterCorners.lowerLeft.y).toBeCloseTo(beforeCorners.lowerLeft.y, 6);
      const afterEdgeMidpoint = new SheetPosition(
        (afterCorners.upperRight.x + afterCorners.lowerRight.x) / 2,
        (afterCorners.upperRight.y + afterCorners.lowerRight.y) / 2,
      );
      expect(afterEdgeMidpoint.x).toBeCloseTo(targetRendered.x, 6);
      expect(afterEdgeMidpoint.y).toBeCloseTo(targetRendered.y, 6);
      ctrlSpy.mockRestore();
    });

    it('pins the center for an alt-resize of a rotated rectangle', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const altSpy = jest.spyOn(toolManager, 'getAltHeld').mockReturnValue(true);
      const rectangle = addRotatedRectangle(
        new SheetPosition(10, 10),
        new SheetPosition(14, 12),
        30,
      );
      const beforeCorners = renderedCorners(rectangle);
      const beforeCenter = new SheetPosition(
        (beforeCorners.upperLeft.x + beforeCorners.lowerRight.x) / 2,
        (beforeCorners.upperLeft.y + beforeCorners.lowerRight.y) / 2,
      );

      const targetRendered = renderPoint(rectangle, new SheetPosition(20, 8));
      const client = startResize(
        [rectangle.id],
        { type: 'corner', corner: 'top-right' },
        targetRendered,
      );
      commitAt(client);

      const after = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;
      const afterCorners = renderedCorners(after);
      const afterCenter = new SheetPosition(
        (afterCorners.upperLeft.x + afterCorners.lowerRight.x) / 2,
        (afterCorners.upperLeft.y + afterCorners.lowerRight.y) / 2,
      );
      expect(afterCenter.x).toBeCloseTo(beforeCenter.x, 6);
      expect(afterCenter.y).toBeCloseTo(beforeCenter.y, 6);
      altSpy.mockRestore();
      ctrlSpy.mockRestore();
    });

    it('preserves fill components and lastFillColor during a rotated resize', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([point(10, 10), point(14, 10), point(14, 12), point(10, 12)], {
          closed: true,
        }),
      );
      setRotation(polygon.id, 30);
      const fillColor = 0x123456;
      geometryStore.updateById(polygon.id, (g) => ({
        ...g,
        components: {
          ...g.components,
          ...FillColorComponent.create(fillColor),
        },
      }));
      geometryStore.updateByIdWithComponent(polygon.id, GeometryComponent, (g) =>
        GeometryComponent.update(g, { lastFillColor: fillColor }),
      );
      const before = geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!;
      expect(FillColorComponent.getOptional(geometryStore.getById(polygon.id)!)).toBe(fillColor);

      const targetRendered = renderPoint(before, new SheetPosition(20, 8));
      const client = startResize(
        [polygon.id],
        { type: 'corner', corner: 'bottom-right' },
        targetRendered,
      );
      commitAt(client);

      const after = geometryStore.getById(polygon.id)!;
      expect(FillColorComponent.getOptional(after)).toBe(fillColor);
      const afterGeometry = GeometryComponent.get(
        geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!,
      );
      if (afterGeometry.type !== 'polygon') {
        throw new Error('Expected polygon');
      }
      expect(afterGeometry.lastFillColor).toBe(fillColor);
      ctrlSpy.mockRestore();
    });

    it('classifies corner resize constraints in the active oriented frame', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const rectangle = addRotatedRectangle(
        new SheetPosition(10, 10),
        new SheetPosition(14, 12),
        30,
      );
      const fixedPoint = new SheetPosition(10, 5);
      geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperLeft'),
          ConstraintEndpoint.point(fixedPoint),
          Length.centimeters(5),
        ),
      );

      // This point is exactly 5 units from the fixed point, so the corner should snap onto the
      // constraint's circular track.
      const targetRendered = new SheetPosition(5, 5);
      const client = startResize(
        [rectangle.id],
        { type: 'corner', corner: 'top-left' },
        targetRendered,
      );
      commitAt(client);

      const resolved = geometryStore.resolveConstraintEndpoint(
        ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperLeft'),
      )!;
      const distance = Math.hypot(resolved.x - fixedPoint.x, resolved.y - fixedPoint.y);
      expect(distance).toBeCloseTo(5, 3);
      ctrlSpy.mockRestore();
    });

    it('classifies edge resize constraints in the active oriented frame', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const rectangle = addRotatedRectangle(
        new SheetPosition(10, 10),
        new SheetPosition(14, 12),
        30,
      );
      const fixedPoint = new SheetPosition(10, 5);
      geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperLeft'),
          ConstraintEndpoint.point(fixedPoint),
          Length.centimeters(5),
        ),
      );

      const frame = computeSelectionResizeFrame([rectangle])!;
      const pivot = frame.bbox.position;
      const localFixed = rotatePointAround(fixedPoint, pivot, -30);
      const dx = localFixed.x - pivot.x;
      const dy = Math.sqrt(Math.max(0, 25 - dx * dx));
      const localTarget = new SheetPosition(pivot.x, localFixed.y - dy);
      const targetRendered = rotatePointAround(localTarget, pivot, 30);

      const client = startResize([rectangle.id], { type: 'edge', edge: 'top' }, targetRendered);
      commitAt(client);

      const resolved = geometryStore.resolveConstraintEndpoint(
        ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperLeft'),
      )!;
      const distance = Math.hypot(resolved.x - fixedPoint.x, resolved.y - fixedPoint.y);
      expect(distance).toBeCloseTo(5, 3);
      ctrlSpy.mockRestore();
    });

    it('applies pointer outset along the rotated frame axes', () => {
      const left = computeResizePointerOutset(
        { type: 'corner', corner: 'top-left' },
        90,
        SELECTED_OUTSET_PX,
      );
      expect(left.x).toBeCloseTo(-SELECTED_OUTSET_PX, 6);
      expect(left.y).toBeCloseTo(SELECTED_OUTSET_PX, 6);

      const right = computeResizePointerOutset(
        { type: 'edge', edge: 'right' },
        90,
        SELECTED_OUTSET_PX,
      );
      expect(right.x).toBeCloseTo(0, 6);
      expect(right.y).toBeCloseTo(-SELECTED_OUTSET_PX, 6);
    });
  });

  describe('anchor handle drag', () => {
    it('moves the anchor along the rendered delta while keeping the rendered geometry fixed', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const rectangle = addRotatedRectangle(
        new SheetPosition(10, 10),
        new SheetPosition(14, 12),
        30,
      );
      geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (g) =>
        AnchorPointComponent.update(g, {
          keyPoint: 'upperLeft',
          offset: new SheetPosition(1, 2),
        }),
      );
      const before = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const beforeCorners = renderedCorners(before);
      const beforeHandle = AnchorPointComponent.getHandlePosition(before);
      const beforeOffset = AnchorPointComponent.get(before).offset;

      const delta = new SheetPosition(5, 1);
      const target = new SheetPosition(beforeHandle.x + delta.x, beforeHandle.y + delta.y);
      selectTool.onAnchorPointPointerDown(new ScreenPosition(0, 0), viewportControls, rectangle.id);
      moveTo(target.toScreen(viewportControls.getState().viewport));
      commitAt(target.toScreen(viewportControls.getState().viewport));

      const after = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const afterCorners = renderedCorners(after);
      const afterHandle = AnchorPointComponent.getHandlePosition(after);
      const afterOffset = AnchorPointComponent.get(after).offset;
      const rawDelta = rotatePointAround(
        new SheetPosition(delta.x, delta.y),
        new SheetPosition(0, 0),
        -30,
      );

      expect(afterHandle.x).toBeCloseTo(target.x, 6);
      expect(afterHandle.y).toBeCloseTo(target.y, 6);
      expect(afterCorners.upperLeft.x).toBeCloseTo(beforeCorners.upperLeft.x, 6);
      expect(afterCorners.upperLeft.y).toBeCloseTo(beforeCorners.upperLeft.y, 6);
      expect(afterCorners.lowerRight.x).toBeCloseTo(beforeCorners.lowerRight.x, 6);
      expect(afterCorners.lowerRight.y).toBeCloseTo(beforeCorners.lowerRight.y, 6);
      expect(afterOffset.x).toBeCloseTo(beforeOffset.x + rawDelta.x, 6);
      expect(afterOffset.y).toBeCloseTo(beforeOffset.y + rawDelta.y, 6);

      historyManager.undo();
      let restored = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      expect(AnchorPointComponent.getHandlePosition(restored).x).toBeCloseTo(beforeHandle.x, 6);
      expect(AnchorPointComponent.getHandlePosition(restored).y).toBeCloseTo(beforeHandle.y, 6);
      expect(AnchorPointComponent.get(restored).offset.x).toBeCloseTo(beforeOffset.x, 6);
      expect(AnchorPointComponent.get(restored).offset.y).toBeCloseTo(beforeOffset.y, 6);

      historyManager.redo();
      restored = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      expect(AnchorPointComponent.getHandlePosition(restored).x).toBeCloseTo(afterHandle.x, 6);
      expect(AnchorPointComponent.getHandlePosition(restored).y).toBeCloseTo(afterHandle.y, 6);
      expect(AnchorPointComponent.get(restored).offset.x).toBeCloseTo(afterOffset.x, 6);
      expect(AnchorPointComponent.get(restored).offset.y).toBeCloseTo(afterOffset.y, 6);
      ctrlSpy.mockRestore();
    });

    it('restores both anchor and geometry when an anchor drag is cancelled', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const rectangle = addRotatedRectangle(
        new SheetPosition(10, 10),
        new SheetPosition(14, 12),
        30,
      );
      geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (g) =>
        AnchorPointComponent.update(g, {
          keyPoint: 'upperLeft',
          offset: new SheetPosition(1, 2),
        }),
      );
      const before = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const beforeHandle = AnchorPointComponent.getHandlePosition(before);
      const beforeCorners = renderedCorners(before);
      const beforeAnchor = AnchorPointComponent.get(before);

      selectTool.onAnchorPointPointerDown(new ScreenPosition(0, 0), viewportControls, rectangle.id);
      moveTo(
        new SheetPosition(beforeHandle.x + 4, beforeHandle.y + 3).toScreen(
          viewportControls.getState().viewport,
        ),
      );
      selectTool.cancelActiveDrag();

      const restored = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const restoredCorners = renderedCorners(restored);
      expect(AnchorPointComponent.getHandlePosition(restored).x).toBeCloseTo(beforeHandle.x, 6);
      expect(AnchorPointComponent.getHandlePosition(restored).y).toBeCloseTo(beforeHandle.y, 6);
      expect(AnchorPointComponent.get(restored).offset.x).toBeCloseTo(beforeAnchor.offset.x, 6);
      expect(AnchorPointComponent.get(restored).offset.y).toBeCloseTo(beforeAnchor.offset.y, 6);
      expect(restoredCorners.upperLeft.x).toBeCloseTo(beforeCorners.upperLeft.x, 6);
      expect(restoredCorners.upperLeft.y).toBeCloseTo(beforeCorners.upperLeft.y, 6);
      ctrlSpy.mockRestore();
    });
  });

  describe('vertex and control drag', () => {
    function addRotatedPolygon(points: Array<SheetPosition>, angleDegrees: number) {
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          points.map((p) => point(p.x, p.y)),
          { closed: false },
        ),
      );
      setRotation(polygon.id, angleDegrees);
      return geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!;
    }

    it('matches points by their rendered positions across rotations', () => {
      const b = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([point(12, 10), point(14, 10), point(14, 12)], { closed: false }),
      );
      setRotation(b.id, 30);
      const bGeometry = geometryStore.getByIdWithComponent(b.id, GeometryComponent)!;
      const renderedPoint = PolygonData.renderedSegments(bGeometry)[1].point;
      const rawPoint = PolygonData.rawSegments(bGeometry)[1].point;
      expect(rawPoint.x).not.toBeCloseTo(renderedPoint.x, 3);

      const a = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            point(renderedPoint.x, renderedPoint.y),
            point(renderedPoint.x + 4, renderedPoint.y),
            point(renderedPoint.x + 4, renderedPoint.y + 2),
          ],
          { closed: false },
        ),
      );

      const renderedMatches = geometryStore.findMatchingPoints(renderedPoint, a.id);
      expect(renderedMatches).toContainEqual({ polygonId: b.id, segmentIndex: 1 });

      const rawMatches = geometryStore.findMatchingPoints(rawPoint, a.id);
      expect(rawMatches.some((match) => match.polygonId === b.id)).toBe(false);
    });

    it('converts a dragged vertex through the full inverse render transform', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const polygon = addRotatedPolygon(
        [
          new SheetPosition(10, 10),
          new SheetPosition(14, 10),
          new SheetPosition(14, 12),
          new SheetPosition(10, 12),
        ],
        30,
      );
      const before = geometryStore.getByIdWithComponents(
        polygon.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const beforeRendered = PolygonData.renderedSegments(before)[0].point;
      const beforeOtherRendered = PolygonData.renderedSegments(before)[1].point;
      const targetRendered = new SheetPosition(13, 9);
      const expectedRaw = rawPointFromRendered(before, targetRendered);

      selectTool.onVertexPointerDown(
        beforeRendered.toScreen(viewportControls.getState().viewport),
        viewportControls,
        polygon.id,
        0,
      );
      moveTo(targetRendered.toScreen(viewportControls.getState().viewport));
      commitAt(targetRendered.toScreen(viewportControls.getState().viewport));

      const after = geometryStore.getByIdWithComponents(
        polygon.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const afterRendered = PolygonData.renderedSegments(after)[0].point;
      const afterOtherRendered = PolygonData.renderedSegments(after)[1].point;
      const afterRaw = PolygonData.rawSegments(after)[0].point;

      expect(afterRaw.x).toBeCloseTo(expectedRaw.x, 6);
      expect(afterRaw.y).toBeCloseTo(expectedRaw.y, 6);
      expect(afterRendered.x).toBeCloseTo(targetRendered.x, 6);
      expect(afterRendered.y).toBeCloseTo(targetRendered.y, 6);
      // The anchor key point was dragged, so the rest of the rendered geometry must stay pinned.
      expect(afterOtherRendered.x).toBeCloseTo(beforeOtherRendered.x, 6);
      expect(afterOtherRendered.y).toBeCloseTo(beforeOtherRendered.y, 6);
      expect(AnchorPointComponent.computeAssociatedGeometryOffset(after).x).toBeCloseTo(
        AnchorPointComponent.computeAssociatedGeometryOffset(before).x,
        6,
      );
      expect(AnchorPointComponent.computeAssociatedGeometryOffset(after).y).toBeCloseTo(
        AnchorPointComponent.computeAssociatedGeometryOffset(before).y,
        6,
      );

      historyManager.undo();
      const restored = geometryStore.getByIdWithComponents(
        polygon.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const restoredRaw = PolygonData.rawSegments(restored)[0].point;
      const originalRaw = PolygonData.rawSegments(before)[0].point;
      expect(restoredRaw.x).toBeCloseTo(originalRaw.x, 6);
      expect(restoredRaw.y).toBeCloseTo(originalRaw.y, 6);
      expect(AnchorPointComponent.get(restored).offset.x).toBeCloseTo(
        AnchorPointComponent.get(before).offset.x,
        6,
      );
      expect(AnchorPointComponent.get(restored).offset.y).toBeCloseTo(
        AnchorPointComponent.get(before).offset.y,
        6,
      );
      ctrlSpy.mockRestore();
    });

    it('converts a dragged control point through the full inverse render transform', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            point(10, 10),
            { type: 'point', point: new SheetPosition(14, 10) },
            {
              type: 'arc-quadratic',
              point: new SheetPosition(18, 10),
              controlPoint: new SheetPosition(16, 8),
            },
          ],
          { closed: false },
        ),
      );
      setRotation(polygon.id, 30);
      const before = geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!;
      const targetRendered = new SheetPosition(20, 4);
      const expectedRaw = rawPointFromRendered(before, targetRendered);

      selectTool.onControlPointerDown(
        new ScreenPosition(0, 0),
        viewportControls,
        polygon.id,
        2,
        'controlPoint',
      );
      moveTo(targetRendered.toScreen(viewportControls.getState().viewport));
      commitAt(targetRendered.toScreen(viewportControls.getState().viewport));

      const after = geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!;
      const afterSegment = GeometryComponent.get(after).points[2] as {
        controlPoint: GeometryRelativeSheetPosition;
      };
      const beforePosition = GeometryComponent.get(before).position;
      expect(afterSegment.controlPoint.x).toBeCloseTo(expectedRaw.x - beforePosition.x, 6);
      expect(afterSegment.controlPoint.y).toBeCloseTo(expectedRaw.y - beforePosition.y, 6);
      const afterRendered = PolygonData.renderedSegments(after)[2] as {
        controlPoint: SheetPosition;
      };
      expect(afterRendered.controlPoint.x).toBeCloseTo(targetRendered.x, 6);
      expect(afterRendered.controlPoint.y).toBeCloseTo(targetRendered.y, 6);
      ctrlSpy.mockRestore();
    });
  });

  describe('line insertion', () => {
    it('inverse-transforms the rendered click before inserting a point', () => {
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([point(10, 10), point(14, 10), point(14, 12)], { closed: false }),
      );
      setRotation(polygon.id, 30);
      const before = geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!;
      const clickRendered = renderPoint(before, new SheetPosition(12, 10));
      const expectedRaw = rawPointFromRendered(before, clickRendered);

      selectTool.addPointOnLineSegmentEdge(polygon.id, 0, clickRendered);

      const after = geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!;
      const inserted = PolygonData.rawSegments(after)[1].point;
      expect(inserted.x).toBeCloseTo(expectedRaw.x, 6);
      expect(inserted.y).toBeCloseTo(expectedRaw.y, 6);
      const insertedRendered = PolygonData.renderedSegments(after)[1].point;
      expect(insertedRendered.x).toBeCloseTo(clickRendered.x, 6);
      expect(insertedRendered.y).toBeCloseTo(clickRendered.y, 6);
    });
  });

  describe('locked points with different transforms', () => {
    it('matches rendered positions and converts the snapped point into each raw frame', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const b = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([point(12, 10), point(14, 10), point(14, 12), point(10, 12)], {
          closed: false,
        }),
      );
      setRotation(b.id, 30);
      const bGeometry = geometryStore.getByIdWithComponent(b.id, GeometryComponent)!;
      const sharedRendered = PolygonData.renderedSegments(bGeometry)[0].point;

      const a = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            point(sharedRendered.x, sharedRendered.y),
            point(sharedRendered.x + 4, sharedRendered.y),
            point(sharedRendered.x + 4, sharedRendered.y + 2),
          ],
          { closed: false },
        ),
      );
      const aGeometry = geometryStore.getByIdWithComponent(a.id, GeometryComponent)!;

      const targetRendered = new SheetPosition(17, 13);
      const expectedARaw = rawPointFromRendered(aGeometry, targetRendered);
      const expectedBRaw = rawPointFromRendered(bGeometry, targetRendered);

      selectTool.onVertexPointerDown(
        sharedRendered.toScreen(viewportControls.getState().viewport),
        viewportControls,
        a.id,
        0,
      );
      moveTo(targetRendered.toScreen(viewportControls.getState().viewport));
      commitAt(targetRendered.toScreen(viewportControls.getState().viewport));

      const afterA = geometryStore.getByIdWithComponent(a.id, GeometryComponent)!;
      const afterB = geometryStore.getByIdWithComponent(b.id, GeometryComponent)!;
      const afterARaw = PolygonData.rawSegments(afterA)[0].point;
      const afterBRaw = PolygonData.rawSegments(afterB)[0].point;
      expect(afterARaw.x).toBeCloseTo(expectedARaw.x, 6);
      expect(afterARaw.y).toBeCloseTo(expectedARaw.y, 6);
      expect(afterBRaw.x).toBeCloseTo(expectedBRaw.x, 6);
      expect(afterBRaw.y).toBeCloseTo(expectedBRaw.y, 6);
      expect(afterBRaw.x).not.toBeCloseTo(afterARaw.x, 3);
      const afterBRendered = PolygonData.renderedSegments(afterB)[0].point;
      expect(afterBRendered.x).toBeCloseTo(targetRendered.x, 6);
      expect(afterBRendered.y).toBeCloseTo(targetRendered.y, 6);
      ctrlSpy.mockRestore();
    });
  });

  describe('multi-selection and link dimensions', () => {
    it('moves a multi-selection of rotated geometries by the rendered delta', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const one = addRotatedRectangle(new SheetPosition(2, 2), new SheetPosition(6, 5), 30);
      const two = addRotatedRectangle(new SheetPosition(10, 2), new SheetPosition(14, 5), 30);
      const oneBefore = renderedCorners(one);
      const twoBefore = renderedCorners(two);

      selectionManager.select(one.id).select(two.id);
      selectTool.handleGeometryFillPointerDown(
        renderPoint(one, new SheetPosition(4, 3.5)).toScreen(viewportControls.getState().viewport),
        viewportControls,
        one.id,
      );
      const delta = new SheetPosition(3, 2);
      moveTo(new SheetPosition(7, 5.5).toScreen(viewportControls.getState().viewport));
      commitAt(new SheetPosition(7, 5.5).toScreen(viewportControls.getState().viewport));

      const afterOne = geometryStore.getByIdWithComponent(one.id, GeometryComponent)!;
      const afterTwo = geometryStore.getByIdWithComponent(two.id, GeometryComponent)!;
      const oneAfter = renderedCorners(afterOne);
      const twoAfter = renderedCorners(afterTwo);
      // The drag starts from a snapped click, so derive the actual rendered delta from one point.
      const actualDelta = new SheetPosition(
        oneAfter.upperLeft.x - oneBefore.upperLeft.x,
        oneAfter.upperLeft.y - oneBefore.upperLeft.y,
      );
      expect(actualDelta.x).not.toBe(0);
      expect(actualDelta.y).not.toBe(0);
      expect(twoAfter.upperLeft.x - twoBefore.upperLeft.x).toBeCloseTo(actualDelta.x, 6);
      expect(twoAfter.upperLeft.y - twoBefore.upperLeft.y).toBeCloseTo(actualDelta.y, 6);
      expect(delta.x).toBeGreaterThan(0);
      ctrlSpy.mockRestore();
    });

    it('enforces linkDimensions in local dimensions for a rotated rectangle', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const rectangle = addRotatedRectangle(
        new SheetPosition(10, 10),
        new SheetPosition(14, 12),
        30,
      );
      geometryStore.updateById(rectangle.id, (g) => ({
        ...g,
        components: {
          ...g.components,
          ...{ linkDimensions: true },
        },
      }));
      const before = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;
      expect(
        GeometryComponent.get(before).width / GeometryComponent.get(before).height,
      ).toBeCloseTo(2, 6);

      const targetRendered = renderPoint(before, new SheetPosition(20, 8));
      const client = startResize(
        [rectangle.id],
        { type: 'corner', corner: 'top-right' },
        targetRendered,
      );
      commitAt(client);

      const after = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;
      const afterData = GeometryComponent.get(after);
      expect(afterData.width / afterData.height).toBeCloseTo(2, 3);
      ctrlSpy.mockRestore();
    });

    it('keeps multi-selection resizing in a common oriented frame when angles match', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const one = addRotatedRectangle(new SheetPosition(2, 2), new SheetPosition(6, 5), 30);
      const two = addRotatedRectangle(new SheetPosition(10, 2), new SheetPosition(14, 5), 30);
      const oneBefore = GeometryComponent.get(one);
      const twoBefore = GeometryComponent.get(two);
      const frame = computeSelectionResizeFrame([
        geometryStore.getById(one.id)!,
        geometryStore.getById(two.id)!,
      ])!;
      expect(frame.strategy).toBe('same-angle');
      expect(frame.bbox.angleDegrees).toBeCloseTo(30);

      const targetRendered = renderPoint(one, new SheetPosition(8, 1));
      const client = startResize(
        [one.id, two.id],
        { type: 'corner', corner: 'top-right' },
        targetRendered,
      );
      commitAt(client);

      const afterOne = GeometryComponent.get(
        geometryStore.getByIdWithComponent(one.id, GeometryComponent)!,
      );
      const afterTwo = GeometryComponent.get(
        geometryStore.getByIdWithComponent(two.id, GeometryComponent)!,
      );
      const oneScaleX = afterOne.width / oneBefore.width;
      const oneScaleY = afterOne.height / oneBefore.height;
      const twoScaleX = afterTwo.width / twoBefore.width;
      const twoScaleY = afterTwo.height / twoBefore.height;
      expect(oneScaleX).not.toBeCloseTo(1, 3);
      expect(oneScaleY).not.toBeCloseTo(1, 3);
      expect(twoScaleX).toBeCloseTo(oneScaleX, 6);
      expect(twoScaleY).toBeCloseTo(oneScaleY, 6);

      const afterFrame = computeSelectionResizeFrame([
        geometryStore.getById(one.id)!,
        geometryStore.getById(two.id)!,
      ])!;
      const beforePinned = OrientedBoundingBox.corners(frame.bbox).lowerLeft;
      const afterPinned = OrientedBoundingBox.corners(afterFrame.bbox).lowerLeft;
      expect(afterPinned.x).toBeCloseTo(beforePinned.x, 6);
      expect(afterPinned.y).toBeCloseTo(beforePinned.y, 6);
      ctrlSpy.mockRestore();
    });

    it('falls back to an axis-aligned frame for mixed angles', () => {
      const one = addRotatedRectangle(new SheetPosition(2, 2), new SheetPosition(6, 5), 30);
      const two = addRotatedRectangle(new SheetPosition(10, 2), new SheetPosition(14, 5), 60);
      const frame = computeSelectionResizeFrame([
        geometryStore.getById(one.id)!,
        geometryStore.getById(two.id)!,
      ])!;
      expect(frame.strategy).toBe('axis-aligned-fallback');
      expect(frame.bbox.angleDegrees).toBe(0);
    });
  });

  describe('history', () => {
    it('undoes and redoes a rotated resize including anchor and rotation changes', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const rectangle = addRotatedRectangle(
        new SheetPosition(10, 10),
        new SheetPosition(14, 12),
        30,
      );
      geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (g) =>
        AnchorPointComponent.update(g, {
          keyPoint: 'upperRight',
          offset: new SheetPosition(1.5, -0.5),
        }),
      );
      const before = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const beforeCorners = renderedCorners(before);
      const beforeAnchor = AnchorPointComponent.get(before);

      const targetRendered = renderPoint(before, new SheetPosition(20, 8));
      const client = startResize(
        [rectangle.id],
        { type: 'corner', corner: 'top-right' },
        targetRendered,
      );
      commitAt(client);

      const after = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const afterCorners = renderedCorners(after);
      const afterAnchor = AnchorPointComponent.get(after);

      historyManager.undo();
      let restored = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      let restoredCorners = renderedCorners(restored);
      expect(restoredCorners.lowerLeft.x).toBeCloseTo(beforeCorners.lowerLeft.x, 6);
      expect(restoredCorners.lowerLeft.y).toBeCloseTo(beforeCorners.lowerLeft.y, 6);
      expect(AnchorPointComponent.get(restored).offset.x).toBeCloseTo(beforeAnchor.offset.x, 6);
      expect(AnchorPointComponent.get(restored).offset.y).toBeCloseTo(beforeAnchor.offset.y, 6);

      historyManager.redo();
      restored = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      restoredCorners = renderedCorners(restored);
      expect(restoredCorners.lowerLeft.x).toBeCloseTo(afterCorners.lowerLeft.x, 6);
      expect(restoredCorners.lowerLeft.y).toBeCloseTo(afterCorners.lowerLeft.y, 6);
      expect(AnchorPointComponent.get(restored).offset.x).toBeCloseTo(afterAnchor.offset.x, 6);
      expect(AnchorPointComponent.get(restored).offset.y).toBeCloseTo(afterAnchor.offset.y, 6);
      ctrlSpy.mockRestore();
    });

    it('cancelling a rotated resize restores geometry and anchor', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const rectangle = addRotatedRectangle(
        new SheetPosition(10, 10),
        new SheetPosition(14, 12),
        30,
      );
      geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (g) =>
        AnchorPointComponent.update(g, {
          keyPoint: 'lowerRight',
          offset: new SheetPosition(1, 2),
        }),
      );
      const before = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const beforeCorners = renderedCorners(before);
      const beforeAnchor = AnchorPointComponent.get(before);

      const targetRendered = renderPoint(before, new SheetPosition(20, 8));
      startResize([rectangle.id], { type: 'corner', corner: 'top-right' }, targetRendered);
      selectTool.cancelActiveDrag();

      const restored = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const restoredCorners = renderedCorners(restored);
      expect(restoredCorners.upperLeft.x).toBeCloseTo(beforeCorners.upperLeft.x, 6);
      expect(restoredCorners.upperLeft.y).toBeCloseTo(beforeCorners.upperLeft.y, 6);
      expect(restoredCorners.lowerRight.x).toBeCloseTo(beforeCorners.lowerRight.x, 6);
      expect(restoredCorners.lowerRight.y).toBeCloseTo(beforeCorners.lowerRight.y, 6);
      expect(AnchorPointComponent.get(restored).offset.x).toBeCloseTo(beforeAnchor.offset.x, 6);
      expect(AnchorPointComponent.get(restored).offset.y).toBeCloseTo(beforeAnchor.offset.y, 6);
      ctrlSpy.mockRestore();
    });
  });

  describe('alt-drag duplication', () => {
    it('preserves rotation and anchor while moving a rotated duplicate', () => {
      const ctrlSpy = jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
      const rectangle = addRotatedRectangle(
        new SheetPosition(10, 10),
        new SheetPosition(14, 12),
        30,
      );
      geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (g) =>
        AnchorPointComponent.update(g, {
          keyPoint: 'upperRight',
          offset: new SheetPosition(1, 2),
        }),
      );
      const before = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const beforeCorners = renderedCorners(before);

      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      const startRendered = renderPoint(before, new SheetPosition(12, 11));
      selectTool.handleGeometryFillPointerDown(
        startRendered.toScreen(viewportControls.getState().viewport),
        viewportControls,
        rectangle.id,
      );
      const targetRendered = new SheetPosition(startRendered.x + 4, startRendered.y + 3);
      moveTo(targetRendered.toScreen(viewportControls.getState().viewport));
      commitAt(targetRendered.toScreen(viewportControls.getState().viewport));
      toolManager.handleKeyUp({ key: 'Alt', altKey: true } as KeyboardEvent);

      const geometries = geometryStore.listWithComponent(GeometryComponent);
      expect(geometries).toHaveLength(2);
      const duplicateId = geometries.find((g) => g.id !== rectangle.id)!.id;
      const duplicate = geometryStore.getByIdWithComponents(
        duplicateId,
        GeometryComponent,
        RotationComponent,
        AnchorPointComponent,
      )!;
      const original = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;

      expect(RotationComponent.get(duplicate).angle.toDegrees().magnitude).toBeCloseTo(30);
      expect(AnchorPointComponent.get(duplicate).keyPoint).toBe('upperRight');
      expect(AnchorPointComponent.get(duplicate).offset.x).toBeCloseTo(1);
      expect(AnchorPointComponent.get(duplicate).offset.y).toBeCloseTo(2);

      const originalCorners = renderedCorners(original);
      const duplicateCorners = renderedCorners(duplicate);
      const actualDeltaX = duplicateCorners.upperLeft.x - originalCorners.upperLeft.x;
      const actualDeltaY = duplicateCorners.upperLeft.y - originalCorners.upperLeft.y;
      expect(actualDeltaX).not.toBe(0);
      expect(actualDeltaY).not.toBe(0);
      expect(originalCorners.upperLeft.x).toBeCloseTo(beforeCorners.upperLeft.x, 6);
      expect(originalCorners.upperLeft.y).toBeCloseTo(beforeCorners.upperLeft.y, 6);
      ctrlSpy.mockRestore();
    });
  });

  describe('overlay frame', () => {
    it('uses the same oriented bounds as the resize frame for a single rotated geometry', () => {
      const rectangle = addRotatedRectangle(
        new SheetPosition(10, 10),
        new SheetPosition(14, 12),
        30,
      );
      const frame = computeSelectionResizeFrame([rectangle])!;
      const expected = Entity.orientedBoundingBoxInSheet(rectangle);
      expect(frame.strategy).toBe('single');
      expect(frame.bbox.position.x).toBeCloseTo(expected.position.x, 6);
      expect(frame.bbox.position.y).toBeCloseTo(expected.position.y, 6);
      expect(frame.bbox.width).toBeCloseTo(expected.width, 6);
      expect(frame.bbox.height).toBeCloseTo(expected.height, 6);
      expect(frame.bbox.angleDegrees).toBeCloseTo(30);
      expect(OrientedBoundingBox.corners(frame.bbox).upperLeft.x).toBeCloseTo(
        expected.position.x,
        6,
      );
    });

    it('unions oriented bounds when all selected angles match', () => {
      const one = addRotatedRectangle(new SheetPosition(2, 2), new SheetPosition(6, 5), 30);
      const two = addRotatedRectangle(new SheetPosition(10, 2), new SheetPosition(14, 5), 30);
      const frame = computeSelectionResizeFrame([one, two])!;
      expect(frame.strategy).toBe('same-angle');
      expect(frame.bbox.angleDegrees).toBeCloseTo(30);
      const localOne = renderPoint(one, new SheetPosition(2, 2));
      const localTwo = renderPoint(two, new SheetPosition(14, 5));
      const corners = OrientedBoundingBox.cornersToArray(frame.bbox);
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      expect(Math.min(...xs)).toBeLessThanOrEqual(localOne.x);
      expect(Math.max(...xs)).toBeGreaterThanOrEqual(localTwo.x);
      expect(Math.min(...ys)).toBeLessThanOrEqual(localOne.y);
      expect(Math.max(...ys)).toBeGreaterThanOrEqual(localTwo.y);
    });
  });
});
