import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  GearParams,
  buildGearToothProfile,
  computeGearMetrics,
  defaultGearParams,
  validateGearParams,
} from '@/lib/actions/GearGeneratorAction';
import {
  AnchorPointComponent,
  ConstraintComponent,
  ConstraintEndpoint,
  DatumComponent,
  FillColorComponent,
  GeometryComponent,
} from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { PatternFilter, PatternRadialFilterData } from '@/lib/entity/filters/pattern';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { Angle } from '@/lib/units/angle';
import { SheetPosition } from '@/lib/viewport/types';

describe('GearGeneratorAction', () => {
  let sheet: Sheet;
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let selectionManager: SelectionManager;
  let toolManager: ToolManager;
  let actionsManager: ActionsManager;

  beforeEach(() => {
    sheet = Sheet.a4();
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    actionsManager = new ActionsManager(sheet, geometryStore, selectionManager, historyManager);
    actionsManager.setToolManager(toolManager);
  });

  const gearParams = (overrides: Partial<GearParams> = {}): GearParams => ({
    ...defaultGearParams(),
    ...overrides,
  });

  it('opens the panel and closes sheet settings', async () => {
    sheet.toggleSheetSettingsPanel();
    const action = actionsManager.getAction('gear-generator');

    await action.execute();

    expect(sheet.sheetSettingsPanelVisible).toBe(false);
    expect(action.getState().panelVisible).toBe(true);
  });

  it('produces one closed preview shape at the origin', async () => {
    const action = actionsManager.getAction('gear-generator');
    await action.execute();

    const state = action.getState();
    expect(state.preview).not.toBeNull();
    expect(state.preview!.shapes).toHaveLength(1);
    const previewShape = state.preview!.shapes[0];
    expect(previewShape.shape).toBe('polygon');
    if (previewShape.shape === 'polygon') {
      expect(previewShape.closed).toBe(true);
    }
    expect(state.params.center.x).toBe(0);
    expect(state.params.center.y).toBe(0);
  });

  it('puts the tooth profile endpoints on the radial slice lines', () => {
    for (const teeth of [3, 4, 6, 8, 12, 20, 40, 100]) {
      const params = gearParams({ teeth });
      const metrics = computeGearMetrics(params, sheet.defaultUnit);
      const profile = buildGearToothProfile(params, sheet.defaultUnit);
      const filterData: PatternRadialFilterData = {
        type: 'pattern',
        mode: 'radial',
        geometryId: 'test',
        center: params.center,
        radius: metrics.outerRadius,
        repeats: { type: 'count', count: teeth },
      };

      expect(
        PatternFilter.arePolygonEndpointsOnEdgeLine(filterData, profile.segments),
      ).not.toBeNull();
    }
  });

  it('places profile points at the root and outer radii', () => {
    const params = gearParams({ teeth: 20 });
    const metrics = computeGearMetrics(params, sheet.defaultUnit);
    const profile = buildGearToothProfile(params, sheet.defaultUnit);

    const distance = (point: SheetPosition) => Math.sqrt(point.x * point.x + point.y * point.y);

    expect(distance(profile.segments[0].point)).toBeCloseTo(metrics.rootRadius, 8);
    expect(distance(profile.segments.at(-1)!.point)).toBeCloseTo(metrics.rootRadius, 8);
    expect(Math.max(...profile.segments.map((segment) => distance(segment.point)))).toBeCloseTo(
      metrics.outerRadius,
      8,
    );
  });

  it('updates the preview when teeth change', async () => {
    const action = actionsManager.getAction('gear-generator');
    await action.execute();
    const initialPointCount = action.getState().preview!.toothSegments.length;

    action.updateParams({ teeth: 12 });

    expect(action.getState().preview!.toothSegments.length).toBe(initialPointCount);
    expect(action.getState().metrics!.outerRadius).toBeGreaterThan(0);
  });

  it('converts between module and diametral pitch while preserving size', async () => {
    const action = actionsManager.getAction('gear-generator');
    await action.execute();
    const originalPitchRadius = action.getState().metrics!.pitchRadius;

    action.setPitchMode('diametral-pitch');

    expect(action.getState().params.pitch).toBeCloseTo(12.7, 6);
    expect(action.getState().metrics!.pitchRadius).toBeCloseTo(originalPitchRadius, 8);
  });

  it('moves the preview when the center is dragged', async () => {
    const action = actionsManager.getAction('gear-generator');
    await action.execute();
    const originalPoint = action.getState().preview!.toothSegments[0].point;

    action.setCenter(new SheetPosition(10, 20));

    const movedPoint = action.getState().preview!.toothSegments[0].point;
    expect(movedPoint.x - originalPoint.x).toBeCloseTo(10, 8);
    expect(movedPoint.y - originalPoint.y).toBeCloseTo(20, 8);
  });

  it('creates a tooth polygon, radial filter, datum, and dimensions', async () => {
    const action = actionsManager.getAction('gear-generator');
    await action.execute();
    action.updateParams({ teeth: 12 });

    action.create();

    const polygons = geometryStore
      .listWithComponent(GeometryComponent)
      .filter((geometry) => GeometryComponent.get(geometry).type === 'polygon');
    expect(polygons).toHaveLength(1);
    expect(GeometryComponent.get(polygons[0]).closed).toBe(false);
    expect(FillColorComponent.getOptional(polygons[0])).toBe(0xcbd5e1);

    const filters = geometryStore.listWithComponent(FilterComponent);
    expect(filters).toHaveLength(1);
    const filterData = FilterComponent.get(filters[0]);
    expect(filterData.type).toBe('pattern');
    if (filterData.type === 'pattern' && filterData.mode === 'radial') {
      expect(filterData.geometryId).toBe(polygons[0].id);
      expect(filterData.repeats.count).toBe(12);
    }

    const datums = geometryStore.listWithComponent(DatumComponent);
    expect(datums).toHaveLength(1);

    const constraints = geometryStore.listWithComponent(ConstraintComponent);
    expect(constraints).toHaveLength(2);
    for (const constraint of constraints) {
      const data = ConstraintComponent.get(constraint);
      expect(data.type).toBe('linear');
      if (data.type === 'linear') {
        expect(
          ConstraintEndpoint.equal(data.pointA, ConstraintEndpoint.lockedToDatum(datums[0].id)) ||
            ConstraintEndpoint.equal(data.pointB, ConstraintEndpoint.lockedToDatum(datums[0].id)),
        ).toBe(true);
      }
    }

    expect(action.getState().panelVisible).toBe(false);
    expect(action.getState().preview).toBeNull();
  });

  it('persists a custom fill color', async () => {
    const action = actionsManager.getAction('gear-generator');
    await action.execute();

    action.updateParams({ fillColor: 0x123456 });
    action.create();

    const polygon = geometryStore
      .listWithComponent(GeometryComponent)
      .find((geometry) => GeometryComponent.get(geometry).type === 'polygon');
    expect(polygon).toBeDefined();
    expect(FillColorComponent.getOptional(polygon!)).toBe(0x123456);
  });

  it('records preview center moves for undo and redo', async () => {
    const action = actionsManager.getAction('gear-generator');
    await action.execute();

    const originalCenter = action.getState().params.center;
    const movedCenter = new SheetPosition(12, 34);
    action.setCenter(movedCenter);
    action.commitCenterMove(originalCenter, movedCenter);

    historyManager.undo();
    expect(action.getState().params.center.x).toBe(originalCenter.x);
    expect(action.getState().params.center.y).toBe(originalCenter.y);

    historyManager.redo();
    expect(action.getState().params.center.x).toBe(movedCenter.x);
    expect(action.getState().params.center.y).toBe(movedCenter.y);
  });

  it('anchors the gear tooth at the gear center', async () => {
    const action = actionsManager.getAction('gear-generator');
    await action.execute();

    const center = new SheetPosition(12, 34);
    action.setCenter(center);
    action.create();

    const polygon = geometryStore
      .listWithComponent(GeometryComponent)
      .find((geometry) => GeometryComponent.get(geometry).type === 'polygon');
    expect(polygon).toBeDefined();

    const withAnchor = geometryStore.getByIdWithComponents(
      polygon!.id,
      GeometryComponent,
      AnchorPointComponent,
    );
    expect(withAnchor).not.toBeNull();
    const handle = AnchorPointComponent.getHandlePosition(withAnchor!);
    expect(handle.x).toBeCloseTo(center.x, 8);
    expect(handle.y).toBeCloseTo(center.y, 8);
  });

  it('removes all generated entities on undo', async () => {
    const action = actionsManager.getAction('gear-generator');
    await action.execute();
    action.create();

    historyManager.undo();

    expect(geometryStore.listWithComponent(GeometryComponent)).toHaveLength(0);
    expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
    expect(geometryStore.listWithComponent(DatumComponent)).toHaveLength(0);
    expect(geometryStore.listWithComponent(ConstraintComponent)).toHaveLength(0);

    historyManager.redo();

    expect(geometryStore.listWithComponent(GeometryComponent)).toHaveLength(1);
    expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(1);
    expect(geometryStore.listWithComponent(DatumComponent)).toHaveLength(1);
    expect(geometryStore.listWithComponent(ConstraintComponent)).toHaveLength(2);
  });

  it('adds nothing when cancelled', async () => {
    const action = actionsManager.getAction('gear-generator');
    await action.execute();

    action.cancel();

    expect(geometryStore.listWithComponent(GeometryComponent)).toHaveLength(0);
    expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
    expect(geometryStore.listWithComponent(DatumComponent)).toHaveLength(0);
    expect(geometryStore.listWithComponent(ConstraintComponent)).toHaveLength(0);
  });

  it('blocks creation for invalid parameters', async () => {
    const action = actionsManager.getAction('gear-generator');
    await action.execute();

    action.updateParams({ teeth: 2 });

    expect(action.getState().validation.valid).toBe(false);
    expect(action.getState().preview).toBeNull();

    action.create();

    expect(geometryStore.listWithComponent(GeometryComponent)).toHaveLength(0);
  });

  it('validates pressure angle and pitch', () => {
    expect(validateGearParams(gearParams({ pressureAngle: Angle.degrees(20) })).valid).toBe(true);
    expect(validateGearParams(gearParams({ pressureAngle: Angle.degrees(1) })).valid).toBe(false);
    expect(validateGearParams(gearParams({ pitch: 0 })).valid).toBe(false);
  });
});
