import {
  AnchorPointComponent,
  Datum,
  Entity,
  FrameComponent,
  GeometryComponent,
  Rectangle,
} from '@/lib/entity';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { Angle } from '@/lib/units/angle';
import { SheetPosition } from '@/lib/viewport/types';

describe('Entity.keyPoints', () => {
  it('returns geometry-relative key points for a geometry', () => {
    const template = Rectangle.create(new SheetPosition(10, 20), new SheetPosition(15, 22));
    const rectangle = { id: 'rect', ...template };

    const keyPoints = Entity.keyPoints(rectangle);

    expect(keyPoints.perimeter.map((point) => `${point.x},${point.y}`)).toEqual([
      '0,0',
      '5,0',
      '5,2',
      '0,2',
    ]);
    expect(keyPoints.extras.center).toMatchObject({ x: 2.5, y: 1 });
  });
});

describe('Entity.keyPointsInSheet', () => {
  it('returns the absolute key point for a datum without crashing', () => {
    const template = Datum.create(new SheetPosition(3, 4));
    const datum = { id: 'dtm', ...template };

    const keyPoints = Entity.keyPointsInSheet(datum);

    expect(keyPoints.perimeter.map((point) => `${point.x},${point.y}`)).toEqual(['3,4']);
    expect(keyPoints.perimeterLabels).toEqual([null]);
    expect(keyPoints.extras).toEqual({});
  });

  it('returns an empty key point set for a frame', () => {
    const frame = {
      id: 'frm',
      components: {
        ...FrameComponent.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      },
    };

    const keyPoints = Entity.keyPointsInSheet(frame);

    expect(keyPoints.perimeter).toEqual([]);
    expect(keyPoints.extras).toEqual({});
  });

  it('projects rotated and anchored geometry key points into rendered sheet space', () => {
    const template = Rectangle.create(new SheetPosition(11, 15), new SheetPosition(16, 17));
    const rectangle = {
      id: 'rect',
      components: {
        ...template.components,
        ...AnchorPointComponent.create({
          keyPoint: 'lowerRight',
          offset: new SheetPosition(-2, -3),
        }),
        ...RotationComponent.create(Angle.degrees(90)),
      },
    };

    const keyPoints = Entity.keyPointsInSheet(rectangle);

    expect(
      keyPoints.perimeter.map((point) => `${point.x.toFixed(0)},${point.y.toFixed(0)}`),
    ).toEqual(['10,12', '10,17', '8,17', '8,12']);
  });

  it('matches GeometryComponent.keyPoints projected with toSheet', () => {
    const template = Rectangle.create(new SheetPosition(10, 20), new SheetPosition(15, 22));
    const rectangle = { id: 'rect', ...template };
    const geometry = rectangle as unknown as Entity<GeometryComponent>;

    const inSheet = Entity.keyPointsInSheet(geometry);
    const relative = Entity.keyPoints(geometry);

    expect(inSheet.perimeter).toEqual(relative.perimeter.map((point) => point.toSheet(geometry)));
  });
});
