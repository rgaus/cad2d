import { Entity, FrameComponent, type Id } from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SheetPosition } from '@/lib/viewport/types';

describe('FrameComponent', () => {
  let geometryStore: GeometryStore;
  beforeEach(() => {
    geometryStore = new GeometryStore(new HistoryManager());
  });

  describe('create and get', () => {
    it('creates a frame with upperLeft and lowerRight, and gets the contents', () => {
      const frame = geometryStore.add<FrameComponent>('f', {
        components: FrameComponent.create(new SheetPosition(3, 4), new SheetPosition(30, 40)),
      });
      const data = FrameComponent.get(frame);
      expect(data.upperLeft.x).toBeCloseTo(3);
      expect(data.upperLeft.y).toBeCloseTo(4);
      expect(data.lowerRight.x).toBeCloseTo(30);
      expect(data.lowerRight.y).toBeCloseTo(40);
    });
  });

  describe('update', () => {
    it('updates upperLeft', () => {
      const entity = geometryStore.add<FrameComponent>('f', {
        components: FrameComponent.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      });

      const updated = FrameComponent.update(entity, { upperLeft: new SheetPosition(5, 6) });
      expect(updated.components.frame.upperLeft.x).toBeCloseTo(5);
      expect(updated.components.frame.upperLeft.y).toBeCloseTo(6);
      expect(updated.components.frame.lowerRight.x).toBeCloseTo(10);
      expect(updated.components.frame.lowerRight.y).toBeCloseTo(10);
    });

    it('updates lowerRight', () => {
      const entity = geometryStore.add<FrameComponent>('f', {
        components: FrameComponent.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      });

      const updated = FrameComponent.update(entity, { lowerRight: new SheetPosition(20, 30) });
      expect(updated.components.frame.lowerRight.x).toBeCloseTo(20);
      expect(updated.components.frame.lowerRight.y).toBeCloseTo(30);
    });
  });

  describe('translate', () => {
    it('translates both corners by the same delta', () => {
      const entity = geometryStore.add<FrameComponent>('f', {
        components: FrameComponent.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      });

      const result = FrameComponent.translate(entity, (p) => new SheetPosition(p.x + 5, p.y + 3));
      const data = (result.components as any).frame;
      expect(data.upperLeft.x).toBeCloseTo(5);
      expect(data.upperLeft.y).toBeCloseTo(3);
      expect(data.lowerRight.x).toBeCloseTo(15);
      expect(data.lowerRight.y).toBeCloseTo(13);
    });
  });

  describe('equals', () => {
    it('returns true for identical frames', () => {
      const a = geometryStore.add<FrameComponent>('f', {
        components: FrameComponent.create(new SheetPosition(1, 2), new SheetPosition(10, 20)),
      });
      const b = geometryStore.add<FrameComponent>('f', {
        components: FrameComponent.create(new SheetPosition(1, 2), new SheetPosition(10, 20)),
      });

      expect(FrameComponent.equals(a, b)).toBe(true);
    });

    it('returns false when upperLeft differs', () => {
      const a = geometryStore.add<FrameComponent>('f', {
        components: FrameComponent.create(new SheetPosition(1, 2), new SheetPosition(10, 20)),
      });
      const b = geometryStore.add<FrameComponent>('f', {
        components: FrameComponent.create(new SheetPosition(3, 2), new SheetPosition(10, 20)),
      });

      expect(FrameComponent.equals(a, b)).toBe(false);
    });
  });

  describe('resizeBBox', () => {
    const bbox = { position: new SheetPosition(2, 4), width: 4, height: 6 };

    it('resizes top edge upward', () => {
      const result = FrameComponent.resizeBBox(bbox, {
        to: new SheetPosition(4, 1),
        mode: { type: 'edge', edge: 'top' },
        altHeld: false,
        shiftHeld: false,
        linkDimensions: false,
      });
      expect(result).not.toBeNull();
      expect(result!.position.x).toBeCloseTo(2);
      expect(result!.position.y).toBeCloseTo(1);
      expect(result!.width).toBeCloseTo(4);
      expect(result!.height).toBeCloseTo(9); // orig bottom at 10, new top at 1
    });

    it('resizes bottom-right corner', () => {
      const result = FrameComponent.resizeBBox(bbox, {
        to: new SheetPosition(10, 14),
        mode: { type: 'corner', corner: 'bottom-right' },
        altHeld: false,
        shiftHeld: false,
        linkDimensions: false,
      });
      expect(result).not.toBeNull();
      expect(result!.position.x).toBeCloseTo(2);
      expect(result!.position.y).toBeCloseTo(4);
      expect(result!.width).toBeCloseTo(8); // 10 - 2
      expect(result!.height).toBeCloseTo(10); // 14 - 4
    });

    it('resizes with shift to preserve aspect ratio', () => {
      // bbox: width=4, height=6, aspect = 4/6 ≈ 0.667
      // Drag bottom-right to (20, 14): dx=18, dy=10
      // scale = max(18/4, 10/6) = max(4.5, 1.667) = 4.5
      // newW = 4*4.5 = 18, newH = 6*4.5 = 27
      const result = FrameComponent.resizeBBox(bbox, {
        to: new SheetPosition(20, 14),
        mode: { type: 'corner', corner: 'bottom-right' },
        altHeld: false,
        shiftHeld: true,
        linkDimensions: false,
      });
      expect(result).not.toBeNull();
      expect(result!.width).toBeCloseTo(18, 1);
      expect(result!.height).toBeCloseTo(27, 1);
    });

    it('resizes with alt to center-anchor', () => {
      // bbox: position(2,4), width=4, height=6 → center(4,7)
      // top edge to y=1: top moved from 4 to 1 (delta -3)
      // With alt, bottom must move from 10 to 13 (delta +3)
      const result = FrameComponent.resizeBBox(bbox, {
        to: new SheetPosition(3, 1),
        mode: { type: 'edge', edge: 'top' },
        altHeld: true,
        shiftHeld: false,
        linkDimensions: false,
      });
      expect(result).not.toBeNull();
      expect(result!.position.y).toBeCloseTo(1); // new top
      expect(result!.height).toBeCloseTo(12); // 13 - 1 = 12
    });

    it('rejects zero-width input bbox when shift is held', () => {
      // resizeBBox returns null when input bbox has zero width/height AND shift is held
      const zeroBBox = { position: new SheetPosition(2, 4), width: 0, height: 6 };
      const result = FrameComponent.resizeBBox(zeroBBox, {
        to: new SheetPosition(10, 10),
        mode: { type: 'corner', corner: 'bottom-right' },
        altHeld: false,
        shiftHeld: true,
        linkDimensions: false,
      });
      expect(result).toBeNull();
    });
  });
});
