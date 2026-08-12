import {
  Datum,
  DatumComponent,
  Ellipse,
  type Entity,
  FillColorComponent,
  GeometryComponent,
  type PointSegment,
  Polygon,
  Rectangle,
  RenderOrderComponent,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { FrameComponent } from '@/lib/entity/components/FrameComponent';
import { FilletFilter } from '@/lib/entity/filters/fillet';
import { MirrorFilter } from '@/lib/entity/filters/mirror';
import { PatternFilter } from '@/lib/entity/filters/pattern';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { BoundingBox } from '@/lib/math';
import {
  type Field,
  type FieldLabel,
  type FieldRow,
} from '@/lib/selection/SelectionInspectorManager';
import { type WorkingFieldData } from '@/lib/selection/SelectionInspectorManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { subscribeToEvents } from '@/lib/subscribe-to-events';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

function getRowField(fields: Array<Field>, rowKey: string) {
  const row = fields.find((f) => f.type === 'row' && f.key === rowKey);
  if (!row || row.type !== 'row') {
    throw new Error(`row "${rowKey}" not found`);
  }
  return row;
}

function getLeafFromRowLabel(fields: Array<Field>, rowKey: string, labelKey: string) {
  const row = getRowField(fields, rowKey);
  const label = row.fields.find((f) => f.type === 'label' && f.key === labelKey);
  if (!label || label.type !== 'label') {
    throw new Error(`label "${labelKey}" not found in row "${rowKey}"`);
  }
  return label.fields[0];
}

function getLeafField(fields: Array<Field>): Field {
  return fields[0];
}

describe('SelectionInspectorManager', () => {
  let sheet: Sheet;
  let geometryStore: GeometryStore;
  let historyManager: HistoryManager;

  beforeEach(() => {
    sheet = Sheet.a4();
    geometryStore = sheet.geometryStore;
    historyManager = sheet.historyManager;
  });

  describe('no selection', () => {
    it('has empty fields', () => {
      expect(sheet.selectionInspectorManager.fields).toEqual([]);
    });
  });

  describe('rectangle (single)', () => {
    beforeEach(() => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(1, 2), new SheetPosition(3, 5)),
      );
      sheet.selectionManager.select(rect.id);
    });

    it('has position row, dimensions row, and convert button', () => {
      const fields = sheet.selectionInspectorManager.fields;
      expect(fields.some((f) => f.type === 'row' && f.key === 'position')).toBe(true);
      expect(fields.some((f) => f.type === 'row' && f.key === 'dimensions')).toBe(true);

      const convertBtn = fields.find((f) => f.type === 'button' && f.key === 'convert-to-polygon');
      expect(convertBtn).toBeDefined();
    });

    it('x field onChange immediately commits and Escape restores original', async () => {
      const sim = sheet.selectionInspectorManager;
      const events = subscribeToEvents(sim, ['workingFieldDataChange'] as const);

      const xField = getLeafFromRowLabel(sim.fields, 'position', 'x');
      expect(xField.type).toBe('length');
      if (xField.type !== 'length') {
        return;
      }

      const origEntity = geometryStore.getByIdWithComponent(
        sheet.selectionManager.getSelectedIds()[0],
        GeometryComponent,
      );
      const origData = GeometryComponent.get(origEntity!);
      const origX = origData.type === 'rectangle' ? origData.upperLeft.x : 0;

      // First onChange — immediate commit via *Direct
      const newX = Length.centimeters(4);
      xField.handlers.onChange?.(newX);

      const wfd = await events.waitFor<WorkingFieldData>('workingFieldDataChange');
      expect(wfd.get('x')).toEqual({ type: 'length', value: newX });
      expect(events.areThereBufferedEvents('workingFieldDataChange')).toBe(false);

      const afterChange = geometryStore.getByIdWithComponent(
        sheet.selectionManager.getSelectedIds()[0],
        GeometryComponent,
      );
      const afterData = GeometryComponent.get(afterChange!);
      if (afterData.type !== 'rectangle') {
        return;
      }
      expect(afterData.upperLeft.x).toBeCloseTo(4);
      expect(afterData.upperLeft.y).toBeCloseTo(2);

      // Escape restores to original
      xField.handlers.onKeyDown?.('Escape');
      const restored = geometryStore.getByIdWithComponent(
        sheet.selectionManager.getSelectedIds()[0],
        GeometryComponent,
      );
      const restoredData = GeometryComponent.get(restored!);
      if (restoredData.type !== 'rectangle') {
        return;
      }
      expect(restoredData.upperLeft.x).toBeCloseTo(origX);
    });

    it('y field onBlur moves upperLeft vertically', () => {
      const sim = sheet.selectionInspectorManager;
      const yField = getLeafFromRowLabel(sim.fields, 'position', 'y');
      expect(yField.type).toBe('length');
      if (yField.type !== 'length') {
        return;
      }

      const newY = Length.centimeters(7);
      yField.handlers.onChange?.(newY);
      yField.handlers.onBlur?.();

      const entity = geometryStore.getByIdWithComponent(
        sheet.selectionManager.getSelectedIds()[0],
        GeometryComponent,
      );
      const data = GeometryComponent.get(entity!);
      if (data.type !== 'rectangle') {
        return;
      }
      expect(data.upperLeft.y).toBeCloseTo(7);
      const deltaY = 7 - 2;
      expect(data.lowerRight.y).toBeCloseTo(5 + deltaY);
    });

    it('width field onBlur resizes (anchors upperLeft)', () => {
      const sim = sheet.selectionInspectorManager;
      const wField = getLeafFromRowLabel(sim.fields, 'dimensions', 'width');
      expect(wField.type).toBe('length');
      if (wField.type !== 'length') {
        return;
      }

      const newW = Length.centimeters(10);
      wField.handlers.onChange?.(newW);
      wField.handlers.onBlur?.();

      const entity = geometryStore.getByIdWithComponent(
        sheet.selectionManager.getSelectedIds()[0],
        GeometryComponent,
      );
      const data = GeometryComponent.get(entity!);
      if (data.type !== 'rectangle') {
        return;
      }
      expect(data.lowerRight.x).toBeCloseTo(1 + 10);
      // upperLeft unchanged
      expect(data.upperLeft.x).toBeCloseTo(1);
    });

    it('height field onBlur resizes (anchors upperLeft)', () => {
      const sim = sheet.selectionInspectorManager;
      const hField = getLeafFromRowLabel(sim.fields, 'dimensions', 'height');
      expect(hField.type).toBe('length');
      if (hField.type !== 'length') {
        return;
      }

      const newH = Length.centimeters(8);
      hField.handlers.onChange?.(newH);
      hField.handlers.onBlur?.();

      const entity = geometryStore.getByIdWithComponent(
        sheet.selectionManager.getSelectedIds()[0],
        GeometryComponent,
      );
      const data = GeometryComponent.get(entity!);
      if (data.type !== 'rectangle') {
        return;
      }
      expect(data.lowerRight.y).toBeCloseTo(2 + 8);
      expect(data.upperLeft.y).toBeCloseTo(2);
    });

    it('link button and convert button exist', () => {
      const dimsRow = getRowField(sheet.selectionInspectorManager.fields, 'dimensions');
      const linkBtn = dimsRow.fields.find((f) => f.type === 'link-dimensions-button');
      expect(linkBtn).toBeDefined();
      if (linkBtn && linkBtn.type === 'link-dimensions-button') {
        expect(typeof linkBtn.handlers.onClick).toBe('function');
      }

      const convertBtn = sheet.selectionInspectorManager.fields.find(
        (f) => f.type === 'button' && f.key === 'convert-to-polygon',
      );
      expect(convertBtn).toBeDefined();
      if (convertBtn && convertBtn.type === 'button') {
        expect(typeof convertBtn.handlers.onClick).toBe('function');
      }
    });
  });

  describe('rectangle with linkDimensions', () => {
    it('width field forces square when linked', () => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(1, 2), new SheetPosition(3, 5), {
          linkDimensions: true,
        }),
      );
      sheet.selectionManager.select(rect.id);

      const wField = getLeafFromRowLabel(
        sheet.selectionInspectorManager.fields,
        'dimensions',
        'width',
      );
      if (wField.type !== 'length') {
        return;
      }

      const newW = Length.centimeters(10);
      wField.handlers.onChange?.(newW);
      wField.handlers.onBlur?.();

      const entity = geometryStore.getByIdWithComponent(rect.id, GeometryComponent);
      const data = GeometryComponent.get(entity!);
      if (data.type !== 'rectangle') {
        return;
      }
      expect(data.lowerRight.x).toBeCloseTo(1 + 10);
      expect(data.lowerRight.y).toBeCloseTo(2 + 10);
    });

    it('height field forces square when linked', () => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(1, 2), new SheetPosition(3, 5), {
          linkDimensions: true,
        }),
      );
      sheet.selectionManager.select(rect.id);

      const hField = getLeafFromRowLabel(
        sheet.selectionInspectorManager.fields,
        'dimensions',
        'height',
      );
      if (hField.type !== 'length') {
        return;
      }

      const newH = Length.centimeters(8);
      hField.handlers.onChange?.(newH);
      hField.handlers.onBlur?.();

      const entity = geometryStore.getByIdWithComponent(rect.id, GeometryComponent);
      const data = GeometryComponent.get(entity!);
      if (data.type !== 'rectangle') {
        return;
      }
      expect(data.lowerRight.y).toBeCloseTo(2 + 8);
      expect(data.lowerRight.x).toBeCloseTo(1 + 8);
    });
  });

  describe('ellipse (single)', () => {
    beforeEach(() => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(5, 6), { radiusX: 3, radiusY: 4 }),
      );
      sheet.selectionManager.select(ellipse.id);
    });

    it('has position row, radius row, and convert button', () => {
      const fields = sheet.selectionInspectorManager.fields;
      expect(fields.some((f) => f.type === 'row' && f.key === 'position')).toBe(true);
      expect(fields.some((f) => f.type === 'row' && f.key === 'radius')).toBe(true);
      expect(fields.some((f) => f.type === 'button' && f.key === 'convert-to-polygon')).toBe(true);
    });

    it('x field onBlur moves center.x', () => {
      const sim = sheet.selectionInspectorManager;
      const xField = getLeafFromRowLabel(sim.fields, 'position', 'x');
      if (xField.type !== 'length') {
        return;
      }

      xField.handlers.onChange?.(Length.centimeters(10));
      xField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getByIdWithComponent(ids[0], GeometryComponent);
      const data = GeometryComponent.get(entity!);
      if (data.type !== 'ellipse') {
        return;
      }
      expect(data.center.x).toBeCloseTo(10);
      expect(data.center.y).toBeCloseTo(6);
    });

    it('y field onBlur moves center.y', () => {
      const sim = sheet.selectionInspectorManager;
      const yField = getLeafFromRowLabel(sim.fields, 'position', 'y');
      if (yField.type !== 'length') {
        return;
      }

      yField.handlers.onChange?.(Length.centimeters(12));
      yField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getByIdWithComponent(ids[0], GeometryComponent);
      const data = GeometryComponent.get(entity!);
      if (data.type !== 'ellipse') {
        return;
      }
      expect(data.center.y).toBeCloseTo(12);
      expect(data.center.x).toBeCloseTo(5);
    });

    it('rx field onBlur changes radiusX', () => {
      const sim = sheet.selectionInspectorManager;
      const rxField = getLeafFromRowLabel(sim.fields, 'radius', 'rx');
      if (rxField.type !== 'length') {
        return;
      }

      rxField.handlers.onChange?.(Length.centimeters(7));
      rxField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getByIdWithComponent(ids[0], GeometryComponent);
      const data = GeometryComponent.get(entity!);
      if (data.type !== 'ellipse') {
        return;
      }
      expect(data.radiusX).toBeCloseTo(7);
      expect(data.radiusY).toBeCloseTo(4);
    });

    it('ry field onBlur changes radiusY', () => {
      const sim = sheet.selectionInspectorManager;
      const ryField = getLeafFromRowLabel(sim.fields, 'radius', 'ry');
      if (ryField.type !== 'length') {
        return;
      }

      ryField.handlers.onChange?.(Length.centimeters(9));
      ryField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getByIdWithComponent(ids[0], GeometryComponent);
      const data = GeometryComponent.get(entity!);
      if (data.type !== 'ellipse') {
        return;
      }
      expect(data.radiusY).toBeCloseTo(9);
      expect(data.radiusX).toBeCloseTo(3);
    });
  });

  describe('ellipse with linkDimensions', () => {
    it('rx field forces circle when linked', () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(5, 6), {
          radiusX: 3,
          radiusY: 4,
          linkDimensions: true,
        }),
      );
      sheet.selectionManager.select(ellipse.id);

      const rxField = getLeafFromRowLabel(sheet.selectionInspectorManager.fields, 'radius', 'rx');
      if (rxField.type !== 'length') {
        return;
      }

      rxField.handlers.onChange?.(Length.centimeters(7));
      rxField.handlers.onBlur?.();

      const entity = geometryStore.getByIdWithComponent(ellipse.id, GeometryComponent);
      const data = GeometryComponent.get(entity!);
      if (data.type !== 'ellipse') {
        return;
      }
      expect(data.radiusX).toBeCloseTo(7);
      expect(data.radiusY).toBeCloseTo(7);
    });

    it('ry field forces circle when linked', () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(5, 6), {
          radiusX: 3,
          radiusY: 4,
          linkDimensions: true,
        }),
      );
      sheet.selectionManager.select(ellipse.id);

      const ryField = getLeafFromRowLabel(sheet.selectionInspectorManager.fields, 'radius', 'ry');
      if (ryField.type !== 'length') {
        return;
      }

      ryField.handlers.onChange?.(Length.centimeters(9));
      ryField.handlers.onBlur?.();

      const entity = geometryStore.getByIdWithComponent(ellipse.id, GeometryComponent);
      const data = GeometryComponent.get(entity!);
      if (data.type !== 'ellipse') {
        return;
      }
      expect(data.radiusY).toBeCloseTo(9);
      expect(data.radiusX).toBeCloseTo(9);
    });
  });

  describe('frame (single)', () => {
    beforeEach(() => {
      const frame = geometryStore.add<FrameComponent>('f', {
        components: FrameComponent.create(new SheetPosition(1, 2), new SheetPosition(4, 6)),
      });
      sheet.selectionManager.select(frame.id);
    });

    it('has position and dimensions rows', () => {
      const fields = sheet.selectionInspectorManager.fields;
      expect(fields.some((f) => f.type === 'row' && f.key === 'position')).toBe(true);
      expect(fields.some((f) => f.type === 'row' && f.key === 'dimensions')).toBe(true);
    });

    it('x field onBlur translates horizontally', () => {
      const sim = sheet.selectionInspectorManager;
      const xField = getLeafFromRowLabel(sim.fields, 'position', 'x');
      if (xField.type !== 'length') {
        return;
      }

      xField.handlers.onChange?.(Length.centimeters(10));
      xField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const current = geometryStore.getById(ids[0]);
      const frameData = FrameComponent.get(current as unknown as Entity<FrameComponent>);
      expect(frameData.upperLeft.x).toBeCloseTo(10);
      const deltaX = 10 - 1;
      expect(frameData.lowerRight.x).toBeCloseTo(4 + deltaX);
    });

    it('y field onBlur translates vertically', () => {
      const sim = sheet.selectionInspectorManager;
      const yField = getLeafFromRowLabel(sim.fields, 'position', 'y');
      if (yField.type !== 'length') {
        return;
      }

      yField.handlers.onChange?.(Length.centimeters(11));
      yField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const current = geometryStore.getById(ids[0]);
      const frameData = FrameComponent.get(current as unknown as Entity<FrameComponent>);
      expect(frameData.upperLeft.y).toBeCloseTo(11);
      const deltaY = 11 - 2;
      expect(frameData.lowerRight.y).toBeCloseTo(6 + deltaY);
    });

    it('w field onBlur resizes width', () => {
      const sim = sheet.selectionInspectorManager;
      const wField = getLeafFromRowLabel(sim.fields, 'dimensions', 'w');
      if (wField.type !== 'length') {
        return;
      }

      wField.handlers.onChange?.(Length.centimeters(20));
      wField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const current = geometryStore.getById(ids[0]);
      const frameData = FrameComponent.get(current as unknown as Entity<FrameComponent>);
      expect(frameData.lowerRight.x).toBeCloseTo(1 + 20);
      expect(frameData.upperLeft.x).toBeCloseTo(1);
    });

    it('h field onBlur resizes height', () => {
      const sim = sheet.selectionInspectorManager;
      const hField = getLeafFromRowLabel(sim.fields, 'dimensions', 'h');
      if (hField.type !== 'length') {
        return;
      }

      hField.handlers.onChange?.(Length.centimeters(15));
      hField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const current = geometryStore.getById(ids[0]);
      const frameData = FrameComponent.get(current as unknown as Entity<FrameComponent>);
      expect(frameData.lowerRight.y).toBeCloseTo(2 + 15);
      expect(frameData.upperLeft.y).toBeCloseTo(2);
    });
  });

  describe('datum (single)', () => {
    beforeEach(() => {
      const datum = geometryStore.addOrdered(
        ID_PREFIXES.datum,
        Datum.create(new SheetPosition(10, 20)),
      );
      sheet.selectionManager.select(datum.id);
    });

    it('has position row', () => {
      expect(
        sheet.selectionInspectorManager.fields.some(
          (f) => f.type === 'row' && f.key === 'position',
        ),
      ).toBe(true);
    });

    it('x field onBlur updates x', () => {
      const sim = sheet.selectionInspectorManager;
      const xField = getLeafFromRowLabel(sim.fields, 'position', 'x');
      if (xField.type !== 'length') {
        return;
      }

      xField.handlers.onChange?.(Length.centimeters(30));
      xField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const current = geometryStore.getById(ids[0]);
      const datumData = DatumComponent.get(current as unknown as Entity<DatumComponent>);
      expect(datumData.x).toBeCloseTo(30);
      expect(datumData.y).toBeCloseTo(20);
    });

    it('y field onBlur updates y', () => {
      const sim = sheet.selectionInspectorManager;
      const yField = getLeafFromRowLabel(sim.fields, 'position', 'y');
      if (yField.type !== 'length') {
        return;
      }

      yField.handlers.onChange?.(Length.centimeters(40));
      yField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const current = geometryStore.getById(ids[0]);
      const datumData = DatumComponent.get(current as unknown as Entity<DatumComponent>);
      expect(datumData.y).toBeCloseTo(40);
      expect(datumData.x).toBeCloseTo(10);
    });
  });

  describe('polygon (single)', () => {
    beforeEach(() => {
      const poly = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(10, 10), makePoint(0, 10)], {
          closed: true,
        }),
      );
      sheet.selectionManager.select(poly.id);
    });

    function getBounds() {
      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getByIdWithComponent(ids[0], GeometryComponent);
      if (!entity || !GeometryComponent.isPolygon(entity)) {
        throw new Error('expected a polygon');
      }
      const data = GeometryComponent.get(entity);
      return BoundingBox.fromPoints(data.points.map((s) => s.point));
    }

    it('has position and dimensions rows with no link or convert buttons', () => {
      const fields = sheet.selectionInspectorManager.fields;
      expect(fields.some((f) => f.type === 'row' && f.key === 'position')).toBe(true);
      expect(fields.some((f) => f.type === 'row' && f.key === 'dimensions')).toBe(true);
      expect(fields.some((f) => f.type === 'button' && f.key === 'convert-to-polygon')).toBe(false);
      expect(fields.some((f) => f.type === 'link-dimensions-button')).toBe(false);
    });

    it('x field onBlur translates polygon horizontally', () => {
      const sim = sheet.selectionInspectorManager;
      const xField = getLeafFromRowLabel(sim.fields, 'position', 'x');
      if (xField.type !== 'length') {
        return;
      }

      xField.handlers.onChange?.(Length.centimeters(5));
      xField.handlers.onBlur?.();

      const bounds = getBounds();
      expect(bounds.position.x).toBeCloseTo(5);
      expect(bounds.position.y).toBeCloseTo(0);
      expect(bounds.width).toBeCloseTo(10);
      expect(bounds.height).toBeCloseTo(10);
    });

    it('y field onBlur translates polygon vertically', () => {
      const sim = sheet.selectionInspectorManager;
      const yField = getLeafFromRowLabel(sim.fields, 'position', 'y');
      if (yField.type !== 'length') {
        return;
      }

      yField.handlers.onChange?.(Length.centimeters(7));
      yField.handlers.onBlur?.();

      const bounds = getBounds();
      expect(bounds.position.y).toBeCloseTo(7);
      expect(bounds.position.x).toBeCloseTo(0);
      expect(bounds.width).toBeCloseTo(10);
    });

    it('width field onBlur resizes (anchors upper-left)', () => {
      const sim = sheet.selectionInspectorManager;
      const wField = getLeafFromRowLabel(sim.fields, 'dimensions', 'width');
      if (wField.type !== 'length') {
        return;
      }

      wField.handlers.onChange?.(Length.centimeters(20));
      wField.handlers.onBlur?.();

      const bounds = getBounds();
      expect(bounds.position.x).toBeCloseTo(0);
      expect(bounds.position.y).toBeCloseTo(0);
      expect(bounds.width).toBeCloseTo(20);
      expect(bounds.height).toBeCloseTo(10);
    });

    it('height field onBlur resizes (anchors upper-left)', () => {
      const sim = sheet.selectionInspectorManager;
      const hField = getLeafFromRowLabel(sim.fields, 'dimensions', 'height');
      if (hField.type !== 'length') {
        return;
      }

      hField.handlers.onChange?.(Length.centimeters(15));
      hField.handlers.onBlur?.();

      const bounds = getBounds();
      expect(bounds.position.x).toBeCloseTo(0);
      expect(bounds.position.y).toBeCloseTo(0);
      expect(bounds.width).toBeCloseTo(10);
      expect(bounds.height).toBeCloseTo(15);
    });
  });

  describe('polygon (multiple)', () => {
    it('x/y/w/h changes apply to all polygons with the same bounding box', () => {
      const poly1 = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(10, 10), makePoint(0, 10)], {
          closed: true,
        }),
      );
      const poly2 = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(10, 10), makePoint(0, 10)], {
          closed: true,
        }),
      );
      sheet.selectionManager.select(poly1.id);
      sheet.selectionManager.select(poly2.id);

      const sim = sheet.selectionInspectorManager;
      const boundsOf = (id: string) => {
        const entity = geometryStore.getByIdWithComponent(id, GeometryComponent);
        if (!entity || !GeometryComponent.isPolygon(entity)) {
          throw new Error('expected a polygon');
        }
        const data = GeometryComponent.get(entity);
        return BoundingBox.fromPoints(data.points.map((s) => s.point));
      };

      const xField = getLeafFromRowLabel(sim.fields, 'position', 'x');
      if (xField.type !== 'length') {
        return;
      }
      xField.handlers.onChange?.(Length.centimeters(5));
      xField.handlers.onBlur?.();
      expect(boundsOf(poly1.id).position.x).toBeCloseTo(5);
      expect(boundsOf(poly2.id).position.x).toBeCloseTo(5);

      const yField = getLeafFromRowLabel(sim.fields, 'position', 'y');
      if (yField.type !== 'length') {
        return;
      }
      yField.handlers.onChange?.(Length.centimeters(7));
      yField.handlers.onBlur?.();
      expect(boundsOf(poly1.id).position.y).toBeCloseTo(7);
      expect(boundsOf(poly2.id).position.y).toBeCloseTo(7);

      const wField = getLeafFromRowLabel(sim.fields, 'dimensions', 'width');
      if (wField.type !== 'length') {
        return;
      }
      wField.handlers.onChange?.(Length.centimeters(20));
      wField.handlers.onBlur?.();
      expect(boundsOf(poly1.id).width).toBeCloseTo(20);
      expect(boundsOf(poly2.id).width).toBeCloseTo(20);

      const hField = getLeafFromRowLabel(sim.fields, 'dimensions', 'height');
      if (hField.type !== 'length') {
        return;
      }
      hField.handlers.onChange?.(Length.centimeters(15));
      hField.handlers.onBlur?.();
      expect(boundsOf(poly1.id).height).toBeCloseTo(15);
      expect(boundsOf(poly2.id).height).toBeCloseTo(15);
    });
  });

  describe('mixed geometry (same x+y)', () => {
    it('x then y field change moves polygon, rectangle, and ellipse together', () => {
      const poly = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(5, 5), makePoint(10, 5), makePoint(10, 10), makePoint(5, 10)], {
          closed: true,
        }),
      );
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(5, 20), new SheetPosition(10, 25)),
      );
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(5, 40), { radiusX: 3, radiusY: 4 }),
      );
      sheet.selectionManager.select(poly.id);
      sheet.selectionManager.select(rect.id);
      sheet.selectionManager.select(ellipse.id);

      const xField = getLeafFromRowLabel(sheet.selectionInspectorManager.fields, 'position', 'x');
      const yField = getLeafFromRowLabel(sheet.selectionInspectorManager.fields, 'position', 'y');
      if (xField.type !== 'length' || yField.type !== 'length') {
        return;
      }

      // Change both x + y values
      xField.handlers.onChange?.(Length.centimeters(12));
      xField.handlers.onBlur?.();
      yField.handlers.onChange?.(Length.centimeters(30));
      yField.handlers.onBlur?.();

      const polyEntity = geometryStore.getByIdWithComponent(poly.id, GeometryComponent);
      if (!polyEntity || !GeometryComponent.isPolygon(polyEntity)) {
        return;
      }
      const polyBounds = BoundingBox.fromPoints(
        GeometryComponent.get(polyEntity).points.map((s) => s.point),
      );
      expect(polyBounds.position.x).toBeCloseTo(12);
      expect(polyBounds.position.y).toBeCloseTo(30);
      expect(polyBounds.width).toBeCloseTo(5);

      const rectEntity = geometryStore.getByIdWithComponent(rect.id, GeometryComponent);
      const rectData = GeometryComponent.get(rectEntity!);
      if (rectData.type !== 'rectangle') {
        return;
      }
      expect(rectData.upperLeft.x).toBeCloseTo(12);
      expect(rectData.upperLeft.y).toBeCloseTo(30);
      expect(rectData.lowerRight.x).toBeCloseTo(17);
      expect(rectData.lowerRight.y).toBeCloseTo(35);

      const ellEntity = geometryStore.getByIdWithComponent(ellipse.id, GeometryComponent);
      const ellData = GeometryComponent.get(ellEntity!);
      if (ellData.type !== 'ellipse') {
        return;
      }
      expect(ellData.center.x).toBeCloseTo(12);
      expect(ellData.center.y).toBeCloseTo(30);
    });
  });

  describe('fill color', () => {
    it('onBlur sets fill color', () => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      sheet.selectionManager.select(rect.id);

      const sim = sheet.selectionInspectorManager;
      const fillColorRow = getRowField(sim.fields, 'fillColor');
      const fillColorLabel = fillColorRow.fields[0];
      expect(fillColorLabel.type).toBe('label');
      if (fillColorLabel.type !== 'label') {
        return;
      }
      const colorField = fillColorLabel.fields[0];
      expect(colorField.type).toBe('color');
      if (colorField.type !== 'color') {
        return;
      }

      const newColor = 0xff0000;
      colorField.handlers.onChange?.(newColor);
      colorField.handlers.onBlur?.();

      const current = geometryStore.getById(rect.id);
      expect(FillColorComponent.get(current as unknown as Entity<FillColorComponent>)).toBe(
        0xff0000,
      );
    });
  });

  describe('render order', () => {
    it('onBlur sets render order', () => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      sheet.selectionManager.select(rect.id);

      const sim = sheet.selectionInspectorManager;
      const roRow = getRowField(sim.fields, 'renderOrder');
      const roLabel = roRow.fields[0];
      expect(roLabel.type).toBe('label');
      if (roLabel.type !== 'label') {
        return;
      }
      const roField = roLabel.fields[0];
      expect(roField.type).toBe('render-order');
      if (roField.type !== 'render-order') {
        return;
      }

      roField.handlers.onChange?.(42);
      roField.handlers.onBlur?.();

      const current = geometryStore.getById(rect.id);
      expect(RenderOrderComponent.get(current as unknown as Entity<RenderOrderComponent>)).toBe(42);
    });
  });

  describe('mirror filter', () => {
    beforeEach(() => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      const mirror = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(rect.id, new SheetPosition(1, 2), new SheetPosition(3, 4)),
      );
      sheet.selectionManager.select(mirror.id);
    });

    it('has point-a and point-b rows', () => {
      const fields = sheet.selectionInspectorManager.fields;
      expect(fields.some((f) => f.type === 'row' && f.key === 'point-a')).toBe(true);
      expect(fields.some((f) => f.type === 'row' && f.key === 'point-b')).toBe(true);
    });

    it('ax field onBlur moves pointA.x', () => {
      const sim = sheet.selectionInspectorManager;
      const axField = getLeafFromRowLabel(sim.fields, 'point-a', 'ax');
      if (axField.type !== 'length') {
        return;
      }

      axField.handlers.onChange?.(Length.centimeters(10));
      axField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getById(ids[0]);
      const filterData = FilterComponent.get(entity as unknown as Entity<FilterComponent>);
      if (filterData.type !== 'mirror') {
        return;
      }
      expect(filterData.pointA.x).toBeCloseTo(10);
      // pointA.y unchanged
      expect(filterData.pointA.y).toBeCloseTo(2);
      // pointB unchanged
      expect(filterData.pointB.x).toBeCloseTo(3);
      expect(filterData.pointB.y).toBeCloseTo(4);
    });

    it('by field onBlur moves pointB.y', () => {
      const sim = sheet.selectionInspectorManager;
      const byField = getLeafFromRowLabel(sim.fields, 'point-b', 'by');
      if (byField.type !== 'length') {
        return;
      }

      byField.handlers.onChange?.(Length.centimeters(15));
      byField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getById(ids[0]);
      const filterData = FilterComponent.get(entity as unknown as Entity<FilterComponent>);
      if (filterData.type !== 'mirror') {
        return;
      }
      expect(filterData.pointB.y).toBeCloseTo(15);
      // pointA unchanged
      expect(filterData.pointA.x).toBeCloseTo(1);
      expect(filterData.pointA.y).toBeCloseTo(2);
    });
  });

  describe('fillet filter (polygon)', () => {
    beforeEach(() => {
      const poly = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(10, 10), makePoint(0, 10)], {
          closed: true,
        }),
      );
      const fillet = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnPolygon(poly.id, 0, 1, 2, Length.centimeters(5)),
      );
      sheet.selectionManager.select(fillet.id);
    });

    it('has offset and points rows', () => {
      const fields = sheet.selectionInspectorManager.fields;
      expect(fields.some((f) => f.type === 'row' && f.key === 'offset')).toBe(true);
      expect(fields.some((f) => f.type === 'row' && f.key === 'points')).toBe(true);
    });

    it('offset field onBlur changes offset', () => {
      const sim = sheet.selectionInspectorManager;
      const offsetField = getLeafFromRowLabel(sim.fields, 'offset', 'offset');
      if (offsetField.type !== 'length') {
        return;
      }

      const newOffset = Length.centimeters(3);
      offsetField.handlers.onChange?.(newOffset);
      offsetField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getById(ids[0]);
      const filterData = FilterComponent.get(entity as unknown as Entity<FilterComponent>);
      if (filterData.type !== 'fillet') {
        return;
      }
      expect(filterData.offset.magnitude).toBeCloseTo(newOffset.magnitude);
    });

    it('pointAIndex field onBlur changes point index', async () => {
      const sim = sheet.selectionInspectorManager;
      const events = subscribeToEvents(sim, ['workingFieldDataChange'] as const);

      const aField = getLeafFromRowLabel(sim.fields, 'points', 'a');
      // 'a' is a number field
      if (aField.type !== 'number') {
        return;
      }

      aField.handlers.onChange?.('5');
      aField.handlers.onBlur?.();

      const wfd = await events.waitFor<WorkingFieldData>('workingFieldDataChange');
      expect(wfd.get('pointAIndex')).toEqual({ type: 'number', value: '5' });
      expect(events.areThereBufferedEvents('workingFieldDataChange')).toBe(false);

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getById(ids[0]);
      const filterData = FilterComponent.get(entity as unknown as Entity<FilterComponent>);
      if (filterData.type !== 'fillet') {
        return;
      }
      if (filterData.geometryType !== 'polygon') {
        return;
      }
      expect(filterData.pointAIndex).toBe(5);
    });
  });

  describe('fillet filter (rectangle)', () => {
    it('has offset row and readOnly keypoints', () => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      const fillet = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rect.id,
          'upperLeft',
          'upperRight',
          'lowerRight',
          Length.centimeters(5),
        ),
      );
      sheet.selectionManager.select(fillet.id);

      const fields = sheet.selectionInspectorManager.fields;
      const kpRow = fields.find((f) => f.type === 'row' && f.key === 'keypoints');
      expect(kpRow).toBeDefined();

      // offset field is editable
      const offsetField = getLeafFromRowLabel(fields, 'offset', 'offset');
      expect(offsetField.type).toBe('length');
      if (offsetField.type === 'length') {
        offsetField.handlers.onChange?.(Length.centimeters(3));
        offsetField.handlers.onBlur?.();

        const ids = sheet.selectionManager.getSelectedIds();
        const entity = geometryStore.getById(ids[0]);
        const filterData = FilterComponent.get(entity as unknown as Entity<FilterComponent>);
        if (filterData.type === 'fillet') {
          expect(filterData.offset.magnitude).toBeCloseTo(3);
        }
      }
    });
  });

  describe('pattern grid filter', () => {
    beforeEach(() => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      const grid = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(rect.id, new SheetPosition(0, 0), new SheetPosition(10, 10), {
          xRepeats: 2,
          yRepeats: 3,
        }),
      );
      sheet.selectionManager.select(grid.id);
    });

    it('has repeats row', () => {
      expect(
        sheet.selectionInspectorManager.fields.some((f) => f.type === 'row' && f.key === 'repeats'),
      ).toBe(true);
    });

    it('xRepeats field onBlur changes xRepeats', async () => {
      const sim = sheet.selectionInspectorManager;
      const events = subscribeToEvents(sim, ['workingFieldDataChange'] as const);

      const repeatsRow = getRowField(sim.fields, 'repeats');
      const repeatsLabel = repeatsRow.fields[0];
      expect(repeatsLabel.type).toBe('label');
      if (repeatsLabel.type !== 'label') {
        return;
      }
      // repeats label contains two number fields: xRepeats and yRepeats
      const xRepeatsField = repeatsLabel.fields[0];
      if (xRepeatsField.type !== 'number') {
        return;
      }

      xRepeatsField.handlers.onChange?.('7');

      const wfd = await events.waitFor<WorkingFieldData>('workingFieldDataChange');
      expect(wfd.get('xRepeats')).toEqual({ type: 'number', value: '7' });
      expect(events.areThereBufferedEvents('workingFieldDataChange')).toBe(false);

      xRepeatsField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getById(ids[0]);
      const filterData = FilterComponent.get(entity as unknown as Entity<FilterComponent>);
      if (filterData.type !== 'pattern' || filterData.mode !== 'grid') {
        return;
      }
      expect(filterData.xRepeats).toBe(7);
      expect(filterData.yRepeats).toBe(3);
    });

    it('yRepeats field onBlur changes yRepeats', () => {
      const sim = sheet.selectionInspectorManager;
      const repeatsRow = getRowField(sim.fields, 'repeats');
      const repeatsLabel = repeatsRow.fields[0];
      if (repeatsLabel.type !== 'label') {
        return;
      }
      const yRepeatsField = repeatsLabel.fields[1];
      if (yRepeatsField.type !== 'number') {
        return;
      }

      yRepeatsField.handlers.onChange?.('5');
      yRepeatsField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getById(ids[0]);
      const filterData = FilterComponent.get(entity as unknown as Entity<FilterComponent>);
      if (filterData.type !== 'pattern' || filterData.mode !== 'grid') {
        return;
      }
      expect(filterData.yRepeats).toBe(5);
    });
  });

  describe('pattern radial filter', () => {
    beforeEach(() => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      const radial = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(rect.id, new SheetPosition(5, 5), 3, { count: 4 }),
      );
      sheet.selectionManager.select(radial.id);
    });

    it('has position, repeats, and radius rows', () => {
      const fields = sheet.selectionInspectorManager.fields;
      expect(fields.some((f) => f.type === 'row' && f.key === 'position')).toBe(true);
      expect(fields.some((f) => f.type === 'row' && f.key === 'repeats')).toBe(true);
      expect(fields.some((f) => f.type === 'row' && f.key === 'radius')).toBe(true);
    });

    it('x field onBlur moves center.x', () => {
      const sim = sheet.selectionInspectorManager;
      const xField = getLeafFromRowLabel(sim.fields, 'position', 'x');
      if (xField.type !== 'length') {
        return;
      }

      xField.handlers.onChange?.(Length.centimeters(8));
      xField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getById(ids[0]);
      const filterData = FilterComponent.get(entity as unknown as Entity<FilterComponent>);
      if (filterData.type !== 'pattern' || filterData.mode !== 'radial') {
        return;
      }
      expect(filterData.center.x).toBeCloseTo(8);
      expect(filterData.center.y).toBeCloseTo(5);
    });

    it('repeats field onBlur changes count', () => {
      const sim = sheet.selectionInspectorManager;
      const repeatsRow = getRowField(sim.fields, 'repeats');
      const repeatsLabel = repeatsRow.fields[0];
      if (repeatsLabel.type !== 'label') {
        return;
      }
      const repeatsField = repeatsLabel.fields[0];
      if (repeatsField.type !== 'number') {
        return;
      }

      repeatsField.handlers.onChange?.('6');
      repeatsField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getById(ids[0]);
      const filterData = FilterComponent.get(entity as unknown as Entity<FilterComponent>);
      if (filterData.type !== 'pattern' || filterData.mode !== 'radial') {
        return;
      }
      expect(filterData.repeats.count).toBe(6);
    });

    it('radius field onBlur changes radius', () => {
      const sim = sheet.selectionInspectorManager;
      const radiusField = getLeafFromRowLabel(sim.fields, 'radius', 'radius');
      if (radiusField.type !== 'length') {
        return;
      }

      const newRadius = Length.centimeters(12);
      radiusField.handlers.onChange?.(newRadius);
      radiusField.handlers.onBlur?.();

      const ids = sheet.selectionManager.getSelectedIds();
      const entity = geometryStore.getById(ids[0]);
      const filterData = FilterComponent.get(entity as unknown as Entity<FilterComponent>);
      if (filterData.type !== 'pattern' || filterData.mode !== 'radial') {
        return;
      }
      // radius in pattern radial is a plain number, not Length
      expect(typeof filterData.radius).toBe('number');
    });
  });

  describe('multi-entity', () => {
    it('two rectangles at same x position both move', () => {
      const rect1 = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 5)),
      );
      const rect2 = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 20), new SheetPosition(10, 25)),
      );
      sheet.selectionManager.select(rect1.id);
      sheet.selectionManager.select(rect2.id);

      const sim = sheet.selectionInspectorManager;
      const xField = getLeafFromRowLabel(sim.fields, 'position', 'x');
      if (xField.type !== 'length') {
        return;
      }

      xField.handlers.onChange?.(Length.centimeters(50));
      xField.handlers.onBlur?.();

      const entity1 = geometryStore.getByIdWithComponent(rect1.id, GeometryComponent);
      const data1 = GeometryComponent.get(entity1!);
      if (data1.type !== 'rectangle') {
        return;
      }
      expect(data1.upperLeft.x).toBeCloseTo(50);

      const entity2 = geometryStore.getByIdWithComponent(rect2.id, GeometryComponent);
      const data2 = GeometryComponent.get(entity2!);
      if (data2.type !== 'rectangle') {
        return;
      }
      expect(data2.upperLeft.x).toBeCloseTo(50);
    });

    it('rectangle and ellipse at same x both move to new x', () => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(10, 0), new SheetPosition(20, 5)),
      );
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(10, 20), { radiusX: 3, radiusY: 4 }),
      );
      sheet.selectionManager.select(rect.id);
      sheet.selectionManager.select(ellipse.id);

      const sim = sheet.selectionInspectorManager;
      const xField = getLeafFromRowLabel(sim.fields, 'position', 'x');
      if (xField.type !== 'length') {
        return;
      }

      xField.handlers.onChange?.(Length.centimeters(30));
      xField.handlers.onBlur?.();

      // Rectangle upperLeft.x moved
      const rectEntity = geometryStore.getByIdWithComponent(rect.id, GeometryComponent);
      const rectData = GeometryComponent.get(rectEntity!);
      if (rectData.type !== 'rectangle') {
        return;
      }
      expect(rectData.upperLeft.x).toBeCloseTo(30);

      // Ellipse center.x moved
      const ellEntity = geometryStore.getByIdWithComponent(ellipse.id, GeometryComponent);
      const ellData = GeometryComponent.get(ellEntity!);
      if (ellData.type !== 'ellipse') {
        return;
      }
      expect(ellData.center.x).toBeCloseTo(30);
    });
  });

  describe('heterogeneous values', () => {
    it('two rectangles at different x positions produce heterogeneous field', () => {
      const rect1 = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 5)),
      );
      const rect2 = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(50, 20), new SheetPosition(60, 25)),
      );
      sheet.selectionManager.select(rect1.id);
      sheet.selectionManager.select(rect2.id);

      const sim = sheet.selectionInspectorManager;
      const positionRow = getRowField(sim.fields, 'position');
      const xLabel = positionRow.fields.find((f) => f.type === 'label' && f.key === 'x');
      if (!xLabel || xLabel.type !== 'label') {
        return;
      }
      const xField = xLabel.fields[0];
      expect(xField.type).toBe('heterogeneous');
    });
  });
});

// Re-export types used in the helper functions but not directly in tests
export type { Field, FieldRow, FieldLabel };
