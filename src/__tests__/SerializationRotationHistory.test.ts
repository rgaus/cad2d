import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  ConstraintComponent,
  Ellipse,
  Entity,
  GeometryComponent,
  Polygon,
  Rectangle,
  RenderOrderComponent,
} from '@/lib/entity';
import { ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { MirrorFilter } from '@/lib/entity/filters/mirror';
import { PatternFilter } from '@/lib/entity/filters/pattern';
import { UndoEntry as UndoEntryNamespace } from '@/lib/history/types';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { parseSvg } from '@/lib/serialization/deserialize';
import {
  serializeFilter,
  serializeLinearConstraint,
  serializePolygon,
  serializeToSvg,
} from '@/lib/serialization/serialize';
import { CURRENT_VERSION, type SerializedState, migrateState } from '@/lib/serialization/versions';
import { Sheet } from '@/lib/sheet/Sheet';
import { ToolManager } from '@/lib/tools/ToolManager';
import { Angle } from '@/lib/units/angle';
import { Length } from '@/lib/units/length';
import { GeometryRelativeSheetPosition, SheetPosition } from '@/lib/viewport/types';

function makeSheet(): Sheet {
  return Sheet.a4();
}

function makeSerializationManager(sheet: Sheet): {
  serializationManager: SerializationManager;
  actionsManager: ActionsManager;
  toolManager: ToolManager;
} {
  const { geometryStore, historyManager, selectionManager } = sheet;
  const toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
  const actionsManager = new ActionsManager(sheet, geometryStore, selectionManager, historyManager);
  const serializationManager = new SerializationManager(actionsManager, toolManager, sheet);
  actionsManager.setSerializationManager(serializationManager);
  toolManager.setSerializationManager(serializationManager);
  return { serializationManager, actionsManager, toolManager };
}

function makePolygon(overrides: {
  id: string;
  points: Array<{ x: number; y: number }>;
  closed?: boolean;
}): Polygon {
  const closed = overrides.closed ?? true;
  const points = overrides.points.map((point) => ({
    type: 'point' as const,
    point: new SheetPosition(point.x, point.y),
  }));
  if (closed) {
    points.push({
      type: 'point',
      point: new SheetPosition(overrides.points[0].x, overrides.points[0].y),
    });
  }
  const template = Polygon.create(points, { closed });
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(0),
    },
  };
}

describe('anchor and rotation persistence', () => {
  it('saves and loads anchor + rotation for rectangles, ellipses, and polygons', () => {
    const sheet = makeSheet();
    const { geometryStore } = sheet;

    const rect = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1)),
    );
    geometryStore.updateByIdWithComponent(rect.id, AnchorPointComponent, (geometry) =>
      AnchorPointComponent.update(geometry, {
        keyPoint: 'center',
        offset: new SheetPosition(0.25, 0.5),
      }),
    );
    geometryStore.updateByIdWithComponent(rect.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(45) }),
    );

    const ellipse = geometryStore.addOrdered(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(3, 3), { radiusX: 1, radiusY: 0.5 }),
    );
    geometryStore.updateByIdWithComponent(ellipse.id, AnchorPointComponent, (geometry) =>
      AnchorPointComponent.update(geometry, {
        keyPoint: 'top',
        offset: new SheetPosition(0.1, 0.2),
      }),
    );
    geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(30) }),
    );

    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([
        { type: 'point', point: new SheetPosition(5, 5) },
        { type: 'point', point: new SheetPosition(6, 5) },
        { type: 'point', point: new SheetPosition(6, 6) },
      ]),
    );
    geometryStore.updateByIdWithComponent(polygon.id, AnchorPointComponent, (geometry) =>
      AnchorPointComponent.update(geometry, {
        keyPoint: 'Point 2',
        offset: new SheetPosition(0.3, 0.4),
      }),
    );
    geometryStore.updateById(polygon.id, (geometry) => ({
      ...geometry,
      components: {
        ...geometry.components,
        ...RotationComponent.create(Angle.degrees(15)),
      },
    }));

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, sheet.historyManager.generateStableId.bind(sheet.historyManager));

    const parsedRect = result.rectangles[0] as unknown as Entity<
      AnchorPointComponent & RotationComponent
    >;
    expect(AnchorPointComponent.get(parsedRect).keyPoint).toBe('center');
    expect(AnchorPointComponent.get(parsedRect).offset.x).toBeCloseTo(0.25);
    expect(AnchorPointComponent.get(parsedRect).offset.y).toBeCloseTo(0.5);
    expect(RotationComponent.get(parsedRect).angle.toDegrees().magnitude).toBeCloseTo(45);

    const parsedEllipse = result.ellipses[0] as unknown as Entity<
      AnchorPointComponent & RotationComponent
    >;
    expect(AnchorPointComponent.get(parsedEllipse).keyPoint).toBe('top');
    expect(AnchorPointComponent.get(parsedEllipse).offset.x).toBeCloseTo(0.1);
    expect(AnchorPointComponent.get(parsedEllipse).offset.y).toBeCloseTo(0.2);
    expect(RotationComponent.get(parsedEllipse).angle.toDegrees().magnitude).toBeCloseTo(30);

    const parsedPolygon = result.polygons[0] as unknown as Entity<
      AnchorPointComponent & RotationComponent
    >;
    expect(AnchorPointComponent.get(parsedPolygon).keyPoint).toBe('Point 2');
    expect(AnchorPointComponent.get(parsedPolygon).offset.x).toBeCloseTo(0.3);
    expect(AnchorPointComponent.get(parsedPolygon).offset.y).toBeCloseTo(0.4);
    expect(RotationComponent.get(parsedPolygon).angle.toDegrees().magnitude).toBeCloseTo(15);
  });

  it('serializes rotated filtered rectangle render shapes with a rotation transform', () => {
    const sheet = makeSheet();
    const { geometryStore } = sheet;

    const rect = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(1, 1), new SheetPosition(3, 2)),
    );
    geometryStore.updateByIdWithComponent(rect.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(45) }),
    );
    const filter = MirrorFilter.create(rect.id, new SheetPosition(0, 0), new SheetPosition(0, 10));
    geometryStore.addDirect({ id: 'ftr_mirror_rot', ...filter } as Entity);

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const renderShapeMatches = svg.match(/<rect (?!id=)[^>]*transform="rotate\(45 [^"]*"/g);
    expect(renderShapeMatches).not.toBeNull();
    expect(renderShapeMatches!.length).toBeGreaterThan(0);
  });

  it('serializes rotated filtered ellipse render shapes with a rotation transform', () => {
    const sheet = makeSheet();
    const { geometryStore } = sheet;

    const ellipse = geometryStore.addOrdered(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(4, 4), { radiusX: 1, radiusY: 0.5 }),
    );
    geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(30) }),
    );
    const filter = PatternFilter.createGrid(
      ellipse.id,
      new SheetPosition(1, 1),
      new SheetPosition(5, 5),
      { xRepeats: 2, yRepeats: 2 },
    );
    geometryStore.addDirect({ id: 'ftr_pattern_rot', ...filter } as Entity);

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const renderShapeMatches = svg.match(/<ellipse (?!id=)[^>]*transform="rotate\(30 [^"]*"/g);
    expect(renderShapeMatches).not.toBeNull();
    expect(renderShapeMatches!.length).toBeGreaterThan(0);
  });

  it('persists polygon lastFillColor and filter order', () => {
    const sheet = makeSheet();
    const { geometryStore } = sheet;

    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create(
        [
          { type: 'point', point: new SheetPosition(0, 0) },
          { type: 'point', point: new SheetPosition(1, 0) },
          { type: 'point', point: new SheetPosition(1, 1) },
        ],
        { closed: false, fillColor: null },
      ),
    );
    geometryStore.updateByIdDirect(polygon.id, (geometry) => ({
      ...geometry,
      components: {
        ...geometry.components,
        geometry: {
          ...GeometryComponent.get(geometry as Entity<GeometryComponent>),
          lastFillColor: 0x123456,
        },
      },
    }));

    const filter = MirrorFilter.create(
      polygon.id,
      new SheetPosition(0, 0),
      new SheetPosition(0, 10),
    );
    geometryStore.addDirect({
      id: 'ftr_ordered',
      ...filter,
      components: {
        ...filter.components,
        filter: { ...filter.components.filter, order: 7 },
      },
    } as Entity);

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, sheet.historyManager.generateStableId.bind(sheet.historyManager));

    const parsedPolygon = result.polygons[0];
    expect(GeometryComponent.get(parsedPolygon).type).toBe('polygon');
    expect(
      (GeometryComponent.get(parsedPolygon) as { lastFillColor?: number | null }).lastFillColor,
    ).toBe(0x123456);
    expect(result.filters).toHaveLength(1);
    expect(result.filters[0].components.filter.order).toBe(7);
  });
});

describe('history codec', () => {
  it('round-trips unit, angle, and position values through the sheet state comment', () => {
    const sheet = makeSheet();
    const { geometryStore, historyManager } = sheet;

    const rect = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1)),
    );
    geometryStore.updateByIdWithComponent(rect.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(22) }),
    );
    geometryStore.updateByIdWithComponent(rect.id, AnchorPointComponent, (geometry) =>
      AnchorPointComponent.update(geometry, {
        keyPoint: 'center',
        offset: new SheetPosition(1.5, 2.5),
      }),
    );

    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([
        { type: 'point', point: new SheetPosition(2, 2) },
        { type: 'point', point: new SheetPosition(3, 2) },
        { type: 'point', point: new SheetPosition(3, 3) },
      ]),
    );
    const polygonData = GeometryComponent.get(polygon);
    if (polygonData.type !== 'polygon') {
      throw new Error('expected polygon');
    }
    historyManager.push(
      UndoEntryNamespace.polygonMove(
        polygon.id,
        polygonData.points,
        polygonData.points.map((segment) => ({
          ...segment,
          point: new GeometryRelativeSheetPosition(segment.point.x + 0.5, segment.point.y),
        })),
        polygonData.position,
        polygonData.position,
      ),
    );
    historyManager.push(
      UndoEntryNamespace.linearConstraintChangeLength(
        'cns_length',
        Length.inches(1),
        Length.meters(2),
      ),
    );
    historyManager.push(
      UndoEntryNamespace.filterChangeOffset('ftr_offset', Length.centimeters(3), Length.feet(4)),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, historyManager.generateStableId.bind(historyManager));

    expect(result.state).not.toBeNull();
    const stack = result.state!.history.undoStack;

    const rotationEntry = stack.find((entry) => entry.type === 'rotation-change');
    expect(rotationEntry).toBeDefined();
    if (rotationEntry?.type === 'rotation-change') {
      expect(rotationEntry.afterRotation.angle).toBeInstanceOf(Angle);
      expect(rotationEntry.afterRotation.angle.toDegrees().magnitude).toBeCloseTo(22);
    }

    const anchorEntry = stack.find((entry) => entry.type === 'anchor-point-move');
    expect(anchorEntry).toBeDefined();
    if (anchorEntry?.type === 'anchor-point-move') {
      expect(anchorEntry.afterAnchorPoint.offset).toBeInstanceOf(SheetPosition);
      expect(anchorEntry.afterAnchorPoint.offset.x).toBeCloseTo(1.5);
      expect(anchorEntry.afterAnchorPoint.offset.y).toBeCloseTo(2.5);
    }

    const polygonEntry = stack.find((entry) => entry.type === 'polygon-move');
    expect(polygonEntry).toBeDefined();
    if (polygonEntry?.type === 'polygon-move') {
      expect(polygonEntry.afterSegments[0].point).toBeInstanceOf(GeometryRelativeSheetPosition);
      expect(polygonEntry.afterSegments[0].point.x).toBeCloseTo(
        polygonData.points[0].point.x + 0.5,
      );
    }

    const lengthEntry = stack.find((entry) => entry.type === 'linear-constraint-change-length');
    expect(lengthEntry).toBeDefined();
    if (lengthEntry?.type === 'linear-constraint-change-length') {
      expect(lengthEntry.afterLength).toBeInstanceOf(Length);
      expect(lengthEntry.afterLength.toMeters().magnitude).toBeCloseTo(2);
    }

    const filterOffsetEntry = stack.find((entry) => entry.type === 'filter-change-offset');
    expect(filterOffsetEntry).toBeDefined();
    if (filterOffsetEntry?.type === 'filter-change-offset') {
      expect(filterOffsetEntry.afterLength).toBeInstanceOf(Length);
      expect(filterOffsetEntry.afterLength.toFeet().magnitude).toBeCloseTo(4);
    }
  });
});

describe('version migration', () => {
  it('runs a loader only when its version exactly matches the state version', () => {
    const sheet = makeSheet();
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const state = parseSvg(
      svg,
      sheet.historyManager.generateStableId.bind(sheet.historyManager),
    ).state!;

    let exactMatchRuns = 0;
    const exactResult = migrateState(JSON.parse(JSON.stringify(state)), [
      {
        version: CURRENT_VERSION,
        migrate: (migrated) => {
          exactMatchRuns += 1;
          return migrated;
        },
      },
    ]);
    expect(exactMatchRuns).toBe(1);
    expect(exactResult.version).toBe(CURRENT_VERSION);

    let olderLoaderRuns = 0;
    migrateState(JSON.parse(JSON.stringify(state)), [
      {
        version: CURRENT_VERSION - 1,
        migrate: (migrated) => {
          olderLoaderRuns += 1;
          return migrated;
        },
      },
    ]);
    expect(olderLoaderRuns).toBe(0);
  });

  it('rejects files written by a newer unsupported version', () => {
    const sheet = makeSheet();
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const state = parseSvg(
      svg,
      sheet.historyManager.generateStableId.bind(sheet.historyManager),
    ).state!;
    const newer = { ...state, version: CURRENT_VERSION + 1 } as SerializedState;
    expect(() => migrateState(newer)).toThrow(/newer than supported/);
  });
});

describe('fallback detection', () => {
  it('marks native cad2d files as non-fallback and plain SVGs as fallback', () => {
    const sheet = makeSheet();
    sheet.geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1)),
    );
    const nativeSvg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const nativeResult = parseSvg(
      nativeSvg,
      sheet.historyManager.generateStableId.bind(sheet.historyManager),
    );
    expect(nativeResult.isFallback).toBe(false);
    expect(nativeResult.isValid).toBe(true);

    const plainSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="10" height="10"/></svg>`;
    const plainResult = parseSvg(
      plainSvg,
      sheet.historyManager.generateStableId.bind(sheet.historyManager),
    );
    expect(plainResult.isFallback).toBe(true);
    expect(plainResult.isValid).toBe(true);
  });
});

describe('ID collisions and references', () => {
  it('rewrites constraint references even when the constraint appears before its geometry', () => {
    const sheet = makeSheet();
    const svg = serializeLinearConstraint(
      {
        type: 'linear',
        pointA: { type: 'locked-polygon', id: 'ply_collision', pointIndex: 0 },
        pointB: { type: 'locked-polygon', id: 'ply_collision', pointIndex: 1 },
        constrainedLength: Length.centimeters(5),
        connectorLineOffsetPx: -12,
        axis: null,
      },
      undefined,
      'cns_collision',
    );
    const polygon = makePolygon({
      id: 'ply_collision',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    });
    const fragment = `<svg xmlns="http://www.w3.org/2000/svg">${svg}${serializePolygon(polygon)}</svg>`;

    const result = parseSvg(
      fragment,
      sheet.historyManager.generateStableId.bind(sheet.historyManager),
      (id) => id === 'ply_collision' || id === 'cns_collision',
    );

    expect(result.polygons).toHaveLength(1);
    expect(result.constraints).toHaveLength(1);
    const newPolygonId = result.polygons[0].id;
    expect(newPolygonId).not.toBe('ply_collision');

    const constraint = result.constraints[0];
    const data = ConstraintComponent.get(constraint);
    if (data.type !== 'linear' || data.pointA.type !== 'locked-polygon') {
      throw new Error('expected linear constraint with locked polygon endpoint');
    }
    expect(data.pointA.id).toBe(newPolygonId);
    expect(data.pointB.type).toBe('locked-polygon');
    if (data.pointB.type === 'locked-polygon') {
      expect(data.pointB.id).toBe(newPolygonId);
    }
  });

  it('rewrites ids referenced by restored history entries', () => {
    const sheet = makeSheet();
    const { geometryStore, historyManager } = sheet;
    const rect = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1)),
    );
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');

    const result = parseSvg(
      svg,
      historyManager.generateStableId.bind(historyManager),
      (id) => id === rect.id,
    );
    const newRectId = result.rectangles[0].id;
    expect(newRectId).not.toBe(rect.id);
    const insertEntry = result.state!.history.undoStack.find((entry) => entry.type === 'insert');
    expect(insertEntry).toBeDefined();
    if (insertEntry?.type === 'insert') {
      expect(insertEntry.geometry.id).toBe(newRectId);
    }
  });

  it('does not rewrite ids when loading a full document over existing geometry', () => {
    const sheet = makeSheet();
    const { geometryStore } = sheet;
    const rect = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1)),
    );
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');

    const parseResult = parseSvg(
      svg,
      sheet.historyManager.generateStableId.bind(sheet.historyManager),
      () => false,
    );
    expect(parseResult.rectangles[0].id).toBe(rect.id);
  });
});

describe('copy/paste transforms and selection restore', () => {
  it('copies anchor and rotation through formatSelectedAsFragment/loadFragment', () => {
    const sheet = makeSheet();
    const { selectionManager, geometryStore } = sheet;
    const { serializationManager } = makeSerializationManager(sheet);

    const rect = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1)),
    );
    geometryStore.updateByIdWithComponent(rect.id, AnchorPointComponent, (geometry) =>
      AnchorPointComponent.update(geometry, {
        keyPoint: 'center',
        offset: new SheetPosition(0.5, 0.25),
      }),
    );
    geometryStore.updateByIdWithComponent(rect.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(60) }),
    );

    selectionManager.select(rect.id);
    const fragment = serializationManager.formatSelectedAsFragment();
    expect(fragment).not.toBeNull();

    const result = serializationManager.loadFragment(fragment!);
    expect(result.success).toBe(true);

    const rectangles = geometryStore
      .listWithComponent(GeometryComponent)
      .filter((geometry) => geometry.id !== rect.id);
    expect(rectangles).toHaveLength(1);
    const pasted = rectangles[0] as unknown as Entity<AnchorPointComponent & RotationComponent>;
    expect(AnchorPointComponent.get(pasted).keyPoint).toBe('center');
    expect(AnchorPointComponent.get(pasted).offset.x).toBeCloseTo(0.5);
    expect(AnchorPointComponent.get(pasted).offset.y).toBeCloseTo(0.25);
    expect(RotationComponent.get(pasted).angle.toDegrees().magnitude).toBeCloseTo(60);
  });

  it('restores the saved selection on full load', () => {
    const sheet = makeSheet();
    const { geometryStore, selectionManager } = sheet;
    const { serializationManager } = makeSerializationManager(sheet);

    const rect = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1)),
    );
    geometryStore.addOrdered(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(3, 3), { radiusX: 1, radiusY: 0.5 }),
    );
    selectionManager.select(rect.id);

    const saveResult = serializationManager.save();
    expect(saveResult.success).toBe(true);
    expect(saveResult.svg).not.toBeNull();

    selectionManager.clearSelection();
    const loadResult = serializationManager.load(saveResult.svg!);
    expect(loadResult.success).toBe(true);
    expect(selectionManager.getSelectedIds()).toContain(rect.id);
  });
});

describe('anchor add/remove history', () => {
  it('tracks anchor component additions and removals for undo/redo', () => {
    const sheet = makeSheet();
    const { geometryStore, historyManager } = sheet;
    const rect = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1)),
    );

    geometryStore.updateByIdDirect(rect.id, (geometry) =>
      AnchorPointComponent.remove(geometry as Entity<AnchorPointComponent>),
    );

    geometryStore.updateById(rect.id, (geometry) => ({
      ...geometry,
      components: {
        ...geometry.components,
        ...AnchorPointComponent.create({
          keyPoint: 'center',
          offset: new SheetPosition(0.1, 0.2),
        }),
      },
    }));
    expect(historyManager.getUndoStack().at(-1)?.type).toBe('anchor-point-add');

    historyManager.undo();
    expect(Entity.hasComponent(geometryStore.getById(rect.id)!, AnchorPointComponent)).toBe(false);
    historyManager.redo();
    expect(Entity.hasComponent(geometryStore.getById(rect.id)!, AnchorPointComponent)).toBe(true);

    geometryStore.updateById(rect.id, (geometry) =>
      AnchorPointComponent.remove(geometry as Entity<AnchorPointComponent>),
    );
    expect(historyManager.getUndoStack().at(-1)?.type).toBe('anchor-point-remove');

    historyManager.undo();
    expect(Entity.hasComponent(geometryStore.getById(rect.id)!, AnchorPointComponent)).toBe(true);
    historyManager.redo();
    expect(Entity.hasComponent(geometryStore.getById(rect.id)!, AnchorPointComponent)).toBe(false);
  });
});
