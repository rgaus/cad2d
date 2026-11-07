import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ShapePreview, {
  type ShapePreviewEditingDimension,
  buildPolygonPath,
  computePreviewProjection,
  getRenderShapeHandlePoints,
} from '@/app/components/ShapePreview';
import {
  AnchorPointComponent,
  Ellipse,
  Entity,
  GeometryComponent,
  PolygonSegment,
  Rectangle,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { Filter } from '@/lib/entity/filters';
import { MirrorFilter } from '@/lib/entity/filters/mirror';
import { type RenderShapeEllipse, type RenderShapeRectangle } from '@/lib/entity/render-shape';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { OrientedBoundingBox } from '@/lib/math';
import { Angle } from '@/lib/units/angle';
import { SheetPosition } from '@/lib/viewport/types';

function setup() {
  const historyManager = new HistoryManager();
  const geometryStore = new GeometryStore(historyManager);
  historyManager.setGeometryStore(geometryStore);
  return geometryStore;
}

function renderPreview(
  geometry: Entity<GeometryComponent>,
  filters: Array<Filter> = [],
  props: {
    editingDimension?: ShapePreviewEditingDimension | null;
    hoveredPointIndex?: number;
  } = {},
) {
  const markup = renderToStaticMarkup(
    createElement(ShapePreview, {
      geometry,
      sheetDefaultUnit: 'cm',
      filters,
      ...props,
    }),
  );
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  return { markup, doc };
}

function renderShapes(geometry: Entity<GeometryComponent>, filters: Array<Filter> = []) {
  return GeometryComponent.getRenderShapes(geometry, 'cm', filters, {
    combineNonClosedPolygons: false,
  });
}

function projectionFor(geometry: Entity<GeometryComponent>, filters: Array<Filter> = []) {
  return computePreviewProjection(renderShapes(geometry, filters));
}

function primaryFor(geometry: Entity<GeometryComponent>, filters: Array<Filter> = []) {
  return renderShapes(geometry, filters).find((shape) => shape.primary)!;
}

function numberAttr(element: Element, name: string): number {
  return Number(element.getAttribute(name));
}

function parsePolylinePoints(value: string | null): Array<[number, number]> {
  return (value ?? '')
    .trim()
    .split(/\s+/)
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [x, y] = entry.split(',').map(Number);
      return [x, y];
    });
}

function addRotatedRectangle(geometryStore: GeometryStore, angleDegrees: number) {
  const rectangle = geometryStore.addOrdered(
    ID_PREFIXES.rectangle,
    Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 4)),
  );
  geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (geometry) =>
    RotationComponent.update(geometry, { angle: Angle.degrees(angleDegrees) }),
  );
  return geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;
}

describe('ShapePreview', () => {
  let geometryStore: GeometryStore;

  beforeEach(() => {
    geometryStore = setup();
  });

  describe('rotation', () => {
    it('rotates a rectangle SVG element around its rendered upper-left corner', () => {
      const geometry = addRotatedRectangle(geometryStore, 30);
      const { doc } = renderPreview(geometry);
      const rectangle = doc.querySelector('[data-preview-shape="rectangle"]')!;
      const primary = primaryFor(geometry) as RenderShapeRectangle;
      const projection = projectionFor(geometry);
      const [expectedX, expectedY] = projection.toSvg(primary.upperLeft.x, primary.upperLeft.y);

      const transform = rectangle.getAttribute('transform')!;
      const match = transform.match(/^rotate\(30 (-?[\d.]+) (-?[\d.]+)\)$/);

      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeCloseTo(expectedX);
      expect(Number(match![2])).toBeCloseTo(expectedY);
    });

    it('rotates an ellipse SVG element around its rendered center', () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(5, 5), { radiusX: 4, radiusY: 2 }),
      );
      geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(45) }),
      );
      const geometry = geometryStore.getByIdWithComponent(ellipse.id, GeometryComponent)!;
      const { doc } = renderPreview(geometry);
      const ellipseElement = doc.querySelector('[data-preview-shape="ellipse"]')!;
      const primary = primaryFor(geometry) as RenderShapeEllipse;
      const projection = projectionFor(geometry);
      const [expectedCx, expectedCy] = projection.toSvg(primary.center.x, primary.center.y);

      expect(numberAttr(ellipseElement, 'cx')).toBeCloseTo(expectedCx);
      expect(numberAttr(ellipseElement, 'cy')).toBeCloseTo(expectedCy);
      const transformMatch = ellipseElement
        .getAttribute('transform')!
        .match(/^rotate\(45 (-?[\d.]+) (-?[\d.]+)\)$/);
      expect(transformMatch).not.toBeNull();
      expect(Number(transformMatch![1])).toBeCloseTo(expectedCx);
      expect(Number(transformMatch![2])).toBeCloseTo(expectedCy);
    });
  });

  describe('bounds', () => {
    it('includes every render shape so mirrored filter output is not clipped', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(4, 2)),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(rectangle.id, new SheetPosition(10, 0), new SheetPosition(10, 10)),
      );
      const geometry = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;
      const filters = [filter];
      const projection = projectionFor(geometry, filters);

      expect(projection.bounds.minX).toBeCloseTo(0);
      expect(projection.bounds.maxX).toBeCloseTo(20);

      const { doc } = renderPreview(geometry, filters);
      const mirrored = doc.querySelector('[data-preview-shape="polygon"]')!;
      const coordinates = (mirrored.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

      expect(Math.min(...coordinates)).toBeGreaterThanOrEqual(7.99);
      expect(Math.max(...coordinates)).toBeLessThanOrEqual(52.01);
      expect(Math.max(...coordinates)).toBeGreaterThan(50);
    });
  });

  describe('dimension guides', () => {
    it('draws width and height guides along a rotated rectangle local axes', () => {
      const geometry = addRotatedRectangle(geometryStore, 90);
      const widthPoints = parsePolylinePoints(
        renderPreview(geometry, [], { editingDimension: 'width' })
          .doc.querySelector('[data-preview-dimension="width"]')!
          .getAttribute('points'),
      );

      expect(widthPoints[1][0]).toBeCloseTo(widthPoints[2][0]);
      expect(widthPoints[1][1]).not.toBeCloseTo(widthPoints[2][1]);

      const heightPoints = parsePolylinePoints(
        renderPreview(geometry, [], { editingDimension: 'height' })
          .doc.querySelector('[data-preview-dimension="height"]')!
          .getAttribute('points'),
      );

      expect(heightPoints[1][1]).toBeCloseTo(heightPoints[2][1]);
      expect(heightPoints[1][0]).not.toBeCloseTo(heightPoints[2][0]);
    });

    it('draws radius guides along rotated ellipse local axes', () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(5, 5), { radiusX: 4, radiusY: 2 }),
      );
      geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(90) }),
      );
      const geometry = geometryStore.getByIdWithComponent(ellipse.id, GeometryComponent)!;

      const radiusXPoints = parsePolylinePoints(
        renderPreview(geometry, [], { editingDimension: 'radiusX' })
          .doc.querySelector('[data-preview-dimension="radiusX"]')!
          .getAttribute('points'),
      );
      expect(radiusXPoints[1][0]).toBeCloseTo(radiusXPoints[2][0]);
      expect(radiusXPoints[1][1]).not.toBeCloseTo(radiusXPoints[2][1]);

      const radiusYPoints = parsePolylinePoints(
        renderPreview(geometry, [], { editingDimension: 'radiusY' })
          .doc.querySelector('[data-preview-dimension="radiusY"]')!
          .getAttribute('points'),
      );
      expect(radiusYPoints[1][1]).toBeCloseTo(radiusYPoints[2][1]);
      expect(radiusYPoints[1][0]).not.toBeCloseTo(radiusYPoints[2][0]);
    });
  });

  describe('origin and center guides', () => {
    it('places the rectangle origin marker at the rendered origin', () => {
      const geometry = addRotatedRectangle(geometryStore, 90);
      const { doc } = renderPreview(geometry, [], { editingDimension: 'origin' });
      const marker = doc.querySelector('[data-preview-origin="rectangle"]')!;
      const upperLeftHandle = doc.querySelector('[data-preview-handle-index="0"]')!;

      expect(numberAttr(marker, 'x') + numberAttr(marker, 'width') / 2).toBeCloseTo(
        numberAttr(upperLeftHandle, 'x') + numberAttr(upperLeftHandle, 'width') / 2,
      );
      expect(numberAttr(marker, 'y') + numberAttr(marker, 'height') / 2).toBeCloseTo(
        numberAttr(upperLeftHandle, 'y') + numberAttr(upperLeftHandle, 'height') / 2,
      );
    });

    it('places the ellipse center marker and guides at rendered values', () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(5, 5), { radiusX: 4, radiusY: 2 }),
      );
      geometryStore.updateByIdWithComponent(ellipse.id, AnchorPointComponent, (geometry) =>
        AnchorPointComponent.update(geometry, {
          keyPoint: 'center',
          offset: new SheetPosition(3, -2),
        }),
      );
      geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(45) }),
      );
      const geometry = geometryStore.getByIdWithComponent(ellipse.id, GeometryComponent)!;
      const primary = primaryFor(geometry) as RenderShapeEllipse;
      const projection = projectionFor(geometry);
      const [expectedCx, expectedCy] = projection.toSvg(primary.center.x, primary.center.y);

      const { doc } = renderPreview(geometry, [], { editingDimension: 'origin' });
      const marker = doc.querySelector('[data-preview-origin="ellipse"]')!;
      const xGuide = doc.querySelector('[data-preview-origin-guide="ellipse-x"]')!;

      expect(numberAttr(marker, 'x') + numberAttr(marker, 'width') / 2).toBeCloseTo(expectedCx);
      expect(numberAttr(marker, 'y') + numberAttr(marker, 'height') / 2).toBeCloseTo(expectedCy);
      expect(numberAttr(xGuide, 'x1')).not.toBeCloseTo(numberAttr(xGuide, 'x2'));
      expect(numberAttr(xGuide, 'y1')).not.toBeCloseTo(numberAttr(xGuide, 'y2'));
    });
  });

  describe('handles', () => {
    it('renders rotated rectangle handles at the oriented corners', () => {
      const geometry = addRotatedRectangle(geometryStore, 30);
      const primary = primaryFor(geometry) as RenderShapeRectangle;
      const projection = projectionFor(geometry);
      const expected = OrientedBoundingBox.cornersToArray({
        position: primary.upperLeft,
        width: primary.lowerRight.x - primary.upperLeft.x,
        height: primary.lowerRight.y - primary.upperLeft.y,
        angleDegrees: primary.angleDegrees,
      }).map((corner) => projection.toSvg(corner.x, corner.y));
      const { doc } = renderPreview(geometry);
      const handles = Array.from(doc.querySelectorAll('[data-preview-handle-index]'));

      expect(handles).toHaveLength(4);
      handles.forEach((handle, index) => {
        expect(numberAttr(handle, 'x') + numberAttr(handle, 'width') / 2).toBeCloseTo(
          expected[index][0],
        );
        expect(numberAttr(handle, 'y') + numberAttr(handle, 'height') / 2).toBeCloseTo(
          expected[index][1],
        );
      });
    });

    it('renders rotated ellipse handles at the rotated extremities', () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(5, 5), { radiusX: 4, radiusY: 2 }),
      );
      geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(45) }),
      );
      const geometry = geometryStore.getByIdWithComponent(ellipse.id, GeometryComponent)!;
      const primary = primaryFor(geometry) as RenderShapeEllipse;
      const projection = projectionFor(geometry);
      const expected = getRenderShapeHandlePoints(primary).map((point) =>
        projection.toSvg(point.x, point.y),
      );
      const { doc } = renderPreview(geometry);
      const handles = Array.from(doc.querySelectorAll('[data-preview-handle-index]'));

      expect(handles).toHaveLength(4);
      handles.forEach((handle, index) => {
        expect(numberAttr(handle, 'x') + numberAttr(handle, 'width') / 2).toBeCloseTo(
          expected[index][0],
        );
        expect(numberAttr(handle, 'y') + numberAttr(handle, 'height') / 2).toBeCloseTo(
          expected[index][1],
        );
      });
    });
  });

  describe('anchor marker', () => {
    it('renders the anchor marker at the rendered anchor location', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(1, 2), new SheetPosition(5, 6)),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (geometry) =>
        AnchorPointComponent.update(geometry, {
          keyPoint: 'center',
          offset: new SheetPosition(2, 3),
        }),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(45) }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expectedPosition = AnchorPointComponent.getHandlePosition(geometry);
      const projection = projectionFor(geometry);
      const [expectedX, expectedY] = projection.toSvg(expectedPosition.x, expectedPosition.y);
      const { doc } = renderPreview(geometry);
      const marker = doc.querySelector('[data-preview-anchor="true"]')!;

      expect(numberAttr(marker, 'x') + numberAttr(marker, 'width') / 2).toBeCloseTo(expectedX);
      expect(numberAttr(marker, 'y') + numberAttr(marker, 'height') / 2).toBeCloseTo(expectedY);
    });
  });
});

describe('buildPolygonPath', () => {
  const toSvg = (x: number, y: number): [number, number] => [x, y];

  function point(x: number, y: number): PolygonSegment {
    return { type: 'point', point: new SheetPosition(x, y) };
  }

  it('does not add a second closing curve when the path already ends at its start', () => {
    const path = buildPolygonPath(
      [
        point(0, 0),
        {
          type: 'arc-cubic',
          controlPointA: new SheetPosition(1, 0),
          controlPointB: new SheetPosition(1, 1),
          point: new SheetPosition(0, 0),
        },
      ],
      toSvg,
      true,
    );

    expect((path.match(/C/g) ?? []).length).toBe(1);
    expect(path.endsWith('Z')).toBe(true);
  });

  it('closes a curved path with one straight closing command', () => {
    const path = buildPolygonPath(
      [
        point(0, 0),
        {
          type: 'arc-cubic',
          controlPointA: new SheetPosition(1, 0),
          controlPointB: new SheetPosition(1, 1),
          point: new SheetPosition(2, 0),
        },
      ],
      toSvg,
      true,
    );

    expect((path.match(/C/g) ?? []).length).toBe(1);
    expect(path.endsWith('Z')).toBe(true);
  });

  it('leaves open curved paths open', () => {
    const path = buildPolygonPath(
      [
        point(0, 0),
        {
          type: 'arc-quadratic',
          controlPoint: new SheetPosition(1, 1),
          point: new SheetPosition(2, 0),
        },
      ],
      toSvg,
      false,
    );

    expect(path.endsWith('Z')).toBe(false);
  });
});
