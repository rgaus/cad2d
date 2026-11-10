import { rotateAnchorAroundPivot, rotatePointAround } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';

/** The world position of a geometry-local point given the entity position and rotation. */
function worldOf(
  position: SheetPosition,
  rotationDegrees: number,
  local: { x: number; y: number },
): SheetPosition {
  return rotatePointAround(
    new SheetPosition(position.x + local.x, position.y + local.y),
    position,
    rotationDegrees,
  );
}

describe('rotateAnchorAroundPivot', () => {
  it('pivots around (0, 0) even if anchor is different', () => {
    const position = new SheetPosition(0, 10);
    const result = rotateAnchorAroundPivot(position, 0, new SheetPosition(0, 0), 90);

    expect(result.position.x).toBeCloseTo(-10);
    expect(result.position.y).toBeCloseTo(0);
    expect(result.rotationDegrees).toBeCloseTo(90);
  });

  it('returns the same position and rotation for a zero delta', () => {
    const position = new SheetPosition(3, 7);
    const result = rotateAnchorAroundPivot(position, 42, new SheetPosition(5, 6), 0);

    expect(result.position.x).toBeCloseTo(position.x);
    expect(result.position.y).toBeCloseTo(position.y);
    expect(result.rotationDegrees).toBeCloseTo(42);
  });

  it('leaves the position in place when the pivot is the raw origin', () => {
    const position = new SheetPosition(3, 7);
    const result = rotateAnchorAroundPivot(position, 20, new SheetPosition(3, 7), 45);

    expect(result.position.x).toBeCloseTo(position.x);
    expect(result.position.y).toBeCloseTo(position.y);
    expect(result.rotationDegrees).toBeCloseTo(65);
  });

  it('keeps the pivot fixed in world space', () => {
    const position = new SheetPosition(3, 7);
    const rotation = 37;
    const localPivot = { x: 2, y: -1 };
    const delta = 53;

    const pivotBefore = worldOf(position, rotation, localPivot);
    const result = rotateAnchorAroundPivot(position, rotation, new SheetPosition(5, 6), delta);
    const pivotAfter = worldOf(result.position, result.rotationDegrees, localPivot);

    expect(pivotAfter.x).toBeCloseTo(pivotBefore.x);
    expect(pivotAfter.y).toBeCloseTo(pivotBefore.y);
  });

  it('rotates an arbitrary local point by the delta around the pivot', () => {
    const position = new SheetPosition(3, 7);
    const rotation = 37;
    const localPivot = { x: 2, y: -1 };
    const delta = 53;
    const localPoint = { x: 5, y: 4 };

    const pointBefore = worldOf(position, rotation, localPoint);
    const pivotBefore = worldOf(position, rotation, localPivot);
    const expected = rotatePointAround(pointBefore, pivotBefore, delta);

    const result = rotateAnchorAroundPivot(position, rotation, new SheetPosition(5, 6), delta);
    const pointAfter = worldOf(result.position, result.rotationDegrees, localPoint);

    expect(pointAfter.x).toBeCloseTo(expected.x);
    expect(pointAfter.y).toBeCloseTo(expected.y);
  });

  it('adds the delta to the absolute rotation', () => {
    const result = rotateAnchorAroundPivot(
      new SheetPosition(0, 0),
      15,
      new SheetPosition(4, 2),
      -30,
    );
    expect(result.rotationDegrees).toBeCloseTo(-15);
  });
});
