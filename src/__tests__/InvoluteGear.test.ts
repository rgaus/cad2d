import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  AnchorPointComponent,
  ConstraintComponent,
  ConstraintEndpoint,
  Datum,
  DatumComponent,
  Entity,
  FillColorComponent,
  GeometryComponent,
  LinearConstraint,
  TransformableComponent,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import {
  InvoluteGearComponent,
  buildGearOutlinePoints,
  defaultInvoluteGearParams,
  involuteGearEndpoint,
} from '@/lib/entity/components/InvoluteGearComponent';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { TransformableTemplate } from '@/lib/entity/components/templates/TransformableTemplate';
import { InvoluteGear } from '@/lib/entity/involute-gear';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { applyKeyPointSnapping } from '@/lib/snapping';
import { SelectTool } from '@/lib/tools/SelectTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { Angle } from '@/lib/units/angle';
import { Length } from '@/lib/units/length';
import { ViewportControls } from '@/lib/viewport/ViewportControls';
import { ScreenPosition, SheetPosition } from '@/lib/viewport/types';

describe('InvoluteGear entity', () => {
  let sheet: Sheet;
  let geometryStore: GeometryStore;
  let historyManager: HistoryManager;
  let selectionManager: SelectionManager;
  let toolManager: ToolManager;
  let selectTool: SelectTool;
  let viewportControls: ViewportControls;
  let moveHandler: ((event: MouseEvent) => void) | undefined;
  let upHandler: ((event: MouseEvent) => void) | undefined;

  beforeEach(() => {
    sheet = Sheet.a4();
    historyManager = sheet.historyManager;
    geometryStore = sheet.geometryStore;
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
    toolManager.setViewportControls(viewportControls);

    moveHandler = undefined;
    upHandler = undefined;
    jest.spyOn(window, 'addEventListener').mockImplementation((event: string, handler: unknown) => {
      if (event === 'mousemove') moveHandler = handler as (event: MouseEvent) => void;
      if (event === 'mouseup') upHandler = handler as (event: MouseEvent) => void;
    });
    jest.spyOn(window, 'removeEventListener').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function addGear(position = new SheetPosition(0, 0)): InvoluteGear {
    return geometryStore.addOrdered(
      ID_PREFIXES.involuteGear,
      InvoluteGear.create(position, sheet.defaultUnit),
    ) as InvoluteGear;
  }

  function toScreen(position: SheetPosition) {
    return position.toScreen(viewportControls.getState().viewport);
  }

  it('creates a renderable, transformable, filled gear', () => {
    const gear = addGear(new SheetPosition(10, 20));
    const data = InvoluteGearComponent.get(gear);
    expect(data.position).toEqual(new SheetPosition(10, 20));
    expect(data.params.teeth).toBe(20);
    expect(FillColorComponent.getOptional(gear)).toBe(0xcbd5e1);
    expect(Entity.hasComponent(gear, TransformableComponent)).toBe(true);
    expect(TransformableComponent.get(gear).component).toBe(InvoluteGearComponent.key);
    expect(TransformableTemplate.getForEntity(gear)).toBe(InvoluteGearComponent);
    expect(Entity.hasComponent(gear, AnchorPointComponent)).toBe(true);
    expect(Entity.hasComponent(gear, RotationComponent)).toBe(true);
    expect(geometryStore.listRenderableGeometries().map((g) => g.id)).toContain(gear.id);

    const shapes = InvoluteGearComponent.getRenderShapes(gear);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].shape).toBe('polygon');
    if (shapes[0].shape === 'polygon') {
      expect(shapes[0].closed).toBe(true);
      expect(shapes[0].points.length).toBeGreaterThan(100);
    }
  });

  it('builds a closed outline from line segments', () => {
    const points = buildGearOutlinePoints(defaultInvoluteGearParams(), 1, new SheetPosition(0, 0));
    expect(points.length).toBeGreaterThan(100);
    expect(points[0].x).not.toBe(points.at(-1)!.x);
  });

  it('places a gear with the tool and clears the preview on blur', () => {
    const tool = toolManager.getTool('involute-gear');
    const viewport = viewportControls.getState();
    tool.handleMouseMove(new ScreenPosition(100, 100), viewport.viewport);
    const working = geometryStore.workingInvoluteGear;
    expect(working).not.toBeNull();

    tool.handleMouseDown(new ScreenPosition(100, 100), viewport.viewport);
    expect(geometryStore.listWithComponent(InvoluteGearComponent)).toHaveLength(1);

    tool.handleToolBlur();
    expect(geometryStore.workingInvoluteGear).toBeNull();
  });

  it('moves a selected gear with undo/redo', () => {
    const gear = addGear(new SheetPosition(10, 10));
    jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);

    selectionManager.select(gear.id);
    const start = toScreen(new SheetPosition(10, 10));
    selectTool.handleGeometryFillPointerDown(start, viewportControls, gear.id);

    const end = toScreen(new SheetPosition(15, 13));
    moveHandler!({ clientX: end.x, clientY: end.y } as MouseEvent);
    upHandler!({ clientX: end.x, clientY: end.y } as MouseEvent);

    const moved = geometryStore.getByIdWithComponent(gear.id, InvoluteGearComponent)!;
    expect(InvoluteGearComponent.get(moved).position.x).toBeCloseTo(15, 6);
    expect(InvoluteGearComponent.get(moved).position.y).toBeCloseTo(13, 6);

    historyManager.undo();
    const undone = geometryStore.getByIdWithComponent(gear.id, InvoluteGearComponent)!;
    expect(InvoluteGearComponent.get(undone).position.x).toBeCloseTo(10, 6);

    historyManager.redo();
    const redone = geometryStore.getByIdWithComponent(gear.id, InvoluteGearComponent)!;
    expect(InvoluteGearComponent.get(redone).position.x).toBeCloseTo(15, 6);
  });

  it('rotates a gear around its center and records history', () => {
    const gear = addGear(new SheetPosition(20, 20));
    selectionManager.select(gear.id);
    const start = toScreen(new SheetPosition(20, 10));
    selectTool.onRotationHandlePointerDown(viewportControls, gear.id, start);
    const end = toScreen(new SheetPosition(30, 20));
    moveHandler!({ clientX: end.x, clientY: end.y } as MouseEvent);
    upHandler!({ clientX: end.x, clientY: end.y } as MouseEvent);

    const rotated = geometryStore.getByIdWithComponent(gear.id, RotationComponent)!;
    expect(Math.abs(RotationComponent.get(rotated).angle.toDegrees().magnitude)).toBeGreaterThan(0);

    historyManager.undo();
    const undone = geometryStore.getByIdWithComponent(gear.id, RotationComponent)!;
    expect(RotationComponent.get(undone).angle.toDegrees().magnitude).toBeCloseTo(0, 6);
  });

  it('lays out inspector fields with shared position keys and full-width button', () => {
    const gear = addGear(new SheetPosition(3, 4));
    const ctx = {
      geometryStore,
      historyManager,
      sheetDefaultUnit: sheet.defaultUnit,
      makeLengthHandlers: () => ({}),
      makeNumberHandlers: () => ({}),
      makeAngleHandlers: () => ({}),
      recomputeFields: jest.fn(),
    } as unknown as Parameters<typeof InvoluteGearComponent.computeSelectionInspectorFields>[1];

    const fields = InvoluteGearComponent.computeSelectionInspectorFields(gear, ctx);
    const positionRow = fields.find((field) => field.type === 'row' && field.key === 'position');
    expect(positionRow).toBeDefined();
    if (positionRow && positionRow.type === 'row') {
      expect(positionRow.fields[0]).toMatchObject({ type: 'label', key: 'x' });
      expect(positionRow.fields[1]).toMatchObject({ type: 'label', key: 'y' });
    }

    const pitchRow = fields.find(
      (field) => field.type === 'row' && field.key === 'involuteGearPitch',
    );
    const teethRow = fields.find(
      (field) => field.type === 'row' && field.key === 'involuteGearTeeth',
    );
    expect(pitchRow).toBeDefined();
    expect(teethRow).toBeDefined();
    if (pitchRow && pitchRow.type === 'row') {
      expect(pitchRow.fields).toHaveLength(1);
    }
    if (teethRow && teethRow.type === 'row') {
      expect(teethRow.fields).toHaveLength(1);
    }
    expect(
      fields.some((field) => field.type === 'button' && field.key === 'involuteGearToPolygon'),
    ).toBe(true);
  });

  it('resolves gear constraint endpoints through the generated adapter', () => {
    const gear = addGear(new SheetPosition(10, 20));
    const center = involuteGearEndpoint.create(gear.id, 'center');
    expect(center.type).toBe('locked-involute-gear');
    expect(ConstraintEndpoint.getEntityId(center)).toBe(gear.id);
    expect(ConstraintEndpoint.getKeyPoint(center)).toBe('center');
    expect(geometryStore.resolveConstraintEndpoint(center)).toEqual(new SheetPosition(10, 20));

    const metrics = InvoluteGearComponent.metricsFor(gear);
    const right = involuteGearEndpoint.create(gear.id, 'right');
    const resolved = geometryStore.resolveConstraintEndpoint(right)!;
    expect(resolved.x).toBeCloseTo(10 + metrics.outerRadius, 8);
    expect(resolved.y).toBeCloseTo(20, 8);
  });

  it('snaps to gear key points generically', () => {
    const gear = addGear(new SheetPosition(10, 20));
    const result = applyKeyPointSnapping(new SheetPosition(10, 20), false, {
      primaryGridSize: 1,
      secondaryGridSize: null,
      superHeld: false,
      manager: selectTool,
      viewportScale: viewportControls.getState().viewport.scale,
      geometries: [],
      constraints: [],
      datums: [],
      constraintEndpointTargets: [gear],
    });
    expect(result.endpoint.type).toBe('locked-involute-gear');
    if (result.endpoint.type === 'locked-involute-gear') {
      expect(result.endpoint.id).toBe(gear.id);
      expect(result.endpoint.keyPoint).toBe('center');
    }
  });

  it('restricts gear dragging using constrained track paths', () => {
    const gear = addGear(new SheetPosition(0, 0));
    const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(new SheetPosition(10, 0)));
    geometryStore.add(
      ID_PREFIXES.constraint,
      LinearConstraint.create(
        involuteGearEndpoint.create(gear.id, 'center'),
        ConstraintEndpoint.lockedToDatum(datum.id),
        Length.fromSheetUnits(sheet.defaultUnit, 10),
      ),
    );

    jest.spyOn(toolManager, 'getCtrlHeld').mockReturnValue(true);
    selectionManager.select(gear.id);
    selectTool.handleGeometryFillPointerDown(
      toScreen(new SheetPosition(0, 0)),
      viewportControls,
      gear.id,
    );
    const end = toScreen(new SheetPosition(30, 0));
    moveHandler!({ clientX: end.x, clientY: end.y } as MouseEvent);
    upHandler!({ clientX: end.x, clientY: end.y } as MouseEvent);

    const moved = geometryStore.getByIdWithComponent(gear.id, InvoluteGearComponent)!;
    const position = InvoluteGearComponent.get(moved).position;
    expect(Math.hypot(position.x - 10, position.y - 0)).toBeCloseTo(10, 5);
  });

  it('cascade-deletes constraints attached to a gear', () => {
    const gear = addGear(new SheetPosition(0, 0));
    const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(new SheetPosition(10, 0)));
    geometryStore.add(
      ID_PREFIXES.constraint,
      LinearConstraint.create(
        involuteGearEndpoint.create(gear.id, 'center'),
        ConstraintEndpoint.lockedToDatum(datum.id),
        Length.fromSheetUnits(sheet.defaultUnit, 10),
      ),
    );
    expect(geometryStore.listWithComponent(ConstraintComponent)).toHaveLength(1);

    geometryStore.deleteById(gear.id);

    expect(geometryStore.listWithComponent(ConstraintComponent)).toHaveLength(0);
  });

  it('converts to an editable polygon, radial filter, datum, and dimensions', () => {
    const gear = addGear(new SheetPosition(10, 10));
    geometryStore.updateById(gear.id, (g) => ({
      ...g,
      components: {
        ...g.components,
        ...RotationComponent.create(Angle.degrees(30)),
      },
    }));

    const ctx = {
      geometryStore,
      historyManager,
      sheetDefaultUnit: sheet.defaultUnit,
      recomputeFields: jest.fn(),
    } as unknown as Parameters<typeof InvoluteGearComponent.toPolygon>[0];
    const current = geometryStore.getByIdWithComponent(gear.id, InvoluteGearComponent)!;
    InvoluteGearComponent.toPolygon(ctx, current);

    expect(geometryStore.listWithComponent(InvoluteGearComponent)).toHaveLength(0);
    const polygons = geometryStore.listWithComponent(GeometryComponent);
    expect(polygons).toHaveLength(1);
    const polygon = polygons[0];
    expect(Entity.hasComponent(polygon, RotationComponent)).toBe(true);
    expect(Entity.hasComponent(polygon, AnchorPointComponent)).toBe(true);
    expect(
      RotationComponent.get(polygon as unknown as Entity<RotationComponent>).angle.toDegrees()
        .magnitude,
    ).toBeCloseTo(30, 6);

    expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(1);
    expect(geometryStore.listWithComponent(DatumComponent)).toHaveLength(1);
    expect(geometryStore.listWithComponent(ConstraintComponent)).toHaveLength(2);

    historyManager.undo();
    expect(geometryStore.listWithComponent(InvoluteGearComponent)).toHaveLength(1);
    expect(geometryStore.listWithComponent(GeometryComponent)).toHaveLength(0);
  });

  it('round-trips gear constraint endpoints through SVG', () => {
    const gear = addGear(new SheetPosition(10, 20));
    const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(new SheetPosition(20, 20)));
    geometryStore.add(
      ID_PREFIXES.constraint,
      LinearConstraint.create(
        involuteGearEndpoint.create(gear.id, 'center'),
        ConstraintEndpoint.lockedToDatum(datum.id),
        Length.fromSheetUnits(sheet.defaultUnit, 10),
      ),
    );

    const serializationManager = toolManager.getSerializationManager()!;
    const saved = serializationManager.save();
    expect(saved.success).toBe(true);
    serializationManager.load(saved.svg!);

    const constraints = geometryStore.listWithComponent(ConstraintComponent);
    expect(constraints).toHaveLength(1);
    const data = ConstraintComponent.get(constraints[0]);
    expect(data.type).toBe('linear');
    if (data.type === 'linear') {
      const gearEndpoint = data.pointA.type === 'locked-involute-gear' ? data.pointA : data.pointB;
      expect(gearEndpoint.type).toBe('locked-involute-gear');
      if (gearEndpoint.type === 'locked-involute-gear') {
        expect(gearEndpoint.keyPoint).toBe('center');
      }
    }
  });

  it('round-trips through SVG serialization', () => {
    const gear = addGear(new SheetPosition(12, 34));
    geometryStore.updateById(gear.id, (g) => ({
      ...g,
      components: {
        ...g.components,
        ...FillColorComponent.create(0x123456),
        ...RotationComponent.create(Angle.degrees(45)),
      },
    }));

    const serializationManager = toolManager.getSerializationManager()!;
    const saved = serializationManager.save();
    expect(saved.success).toBe(true);
    expect(saved.svg).toBeTruthy();
    expect(saved.svg!).toContain('data-type="involute-gear"');

    serializationManager.load(saved.svg!);

    const loaded = geometryStore.listWithComponent(InvoluteGearComponent);
    expect(loaded).toHaveLength(1);
    const data = InvoluteGearComponent.get(loaded[0]);
    expect(data.position.x).toBeCloseTo(12, 6);
    expect(data.position.y).toBeCloseTo(34, 6);
    expect(data.params.teeth).toBe(20);
    expect(FillColorComponent.getOptional(loaded[0])).toBe(0x123456);
    expect(
      RotationComponent.get(loaded[0] as unknown as Entity<RotationComponent>).angle.toDegrees()
        .magnitude,
    ).toBeCloseTo(45, 6);
  });
});
