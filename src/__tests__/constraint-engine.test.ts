import {
  getLoss,
  gradientDescent,
  isInConflict,
  positionsToState,
  stateToPositions,
} from '@/lib/constraint-engine';
import type { EngineConstraint } from '@/lib/constraint-engine';
import { distance } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';

describe('constraint-engine', () => {
  describe('positionsToState / stateToPositions roundtrip', () => {
    it('converts positions to state and back', () => {
      const positionsKeyOrder = ['a', 'b'];
      const positions = new Map<string, SheetPosition>();
      positions.set('a', new SheetPosition(3, 4));
      positions.set('b', new SheetPosition(7, 9));

      const state = positionsToState(positionsKeyOrder, positions);
      expect(state).toEqual([3, 4, 7, 9]);

      const restored = stateToPositions(positionsKeyOrder, state);
      expect(restored.get('a')!.x).toBe(3);
      expect(restored.get('a')!.y).toBe(4);
      expect(restored.get('b')!.x).toBe(7);
      expect(restored.get('b')!.y).toBe(9);
    });
  });

  describe('isInConflict', () => {
    it('returns false when all constraints are satisfied', () => {
      const positions = new Map<string, SheetPosition>();
      positions.set('a', new SheetPosition(0, 0));
      positions.set('b', new SheetPosition(5, 0));

      const constraints: Array<EngineConstraint> = [
        { type: 'distance', pointA: 'a', pointB: 'b', targetDistance: 5 },
      ];

      expect(isInConflict(constraints, positions)).toBe(false);
    });

    it('returns true when a constraint is violated', () => {
      const positions = new Map<string, SheetPosition>();
      positions.set('a', new SheetPosition(0, 0));
      positions.set('b', new SheetPosition(10, 0));

      const constraints: Array<EngineConstraint> = [
        { type: 'distance', pointA: 'a', pointB: 'b', targetDistance: 5 },
      ];

      expect(isInConflict(constraints, positions)).toBe(true);
    });

    it('returns false when distanceX is satisfied', () => {
      const positions = new Map<string, SheetPosition>();
      positions.set('a', new SheetPosition(0, 0));
      positions.set('b', new SheetPosition(5, 3));

      const constraints: Array<EngineConstraint> = [
        { type: 'distanceX', pointA: 'a', pointB: 'b', targetDistance: 5 },
      ];

      expect(isInConflict(constraints, positions)).toBe(false);
    });

    it('returns true when distanceX is violated', () => {
      const positions = new Map<string, SheetPosition>();
      positions.set('a', new SheetPosition(0, 0));
      positions.set('b', new SheetPosition(10, 0));

      const constraints: Array<EngineConstraint> = [
        { type: 'distanceX', pointA: 'a', pointB: 'b', targetDistance: 5 },
      ];

      expect(isInConflict(constraints, positions)).toBe(true);
    });

    it('returns false when distanceY is satisfied', () => {
      const positions = new Map<string, SheetPosition>();
      positions.set('a', new SheetPosition(0, 0));
      positions.set('b', new SheetPosition(3, 5));

      const constraints: Array<EngineConstraint> = [
        { type: 'distanceY', pointA: 'a', pointB: 'b', targetDistance: 5 },
      ];

      expect(isInConflict(constraints, positions)).toBe(false);
    });

    it('returns true when distanceY is violated', () => {
      const positions = new Map<string, SheetPosition>();
      positions.set('a', new SheetPosition(0, 0));
      positions.set('b', new SheetPosition(0, 10));

      const constraints: Array<EngineConstraint> = [
        { type: 'distanceY', pointA: 'a', pointB: 'b', targetDistance: 5 },
      ];

      expect(isInConflict(constraints, positions)).toBe(true);
    });
  });

  describe('constraint gradient descent solver', () => {
    it('solves a triangle with distance and perpendicular constraints', () => {
      const positionsKeyOrder = ['a', 'b', 'c'];
      const positions = new Map<string, SheetPosition>();
      positions.set('a', new SheetPosition(5, 0));
      positions.set('b', new SheetPosition(12, 0));
      positions.set('c', new SheetPosition(7, 6));

      const engineConstraints: Array<EngineConstraint> = [
        { type: 'distance', pointA: 'a', pointB: 'b', targetDistance: 5 },
        { type: 'distance', pointA: 'b', pointB: 'c', targetDistance: 5 },
        { type: 'horizontal', pointA: 'a', pointB: 'b' },
        {
          type: 'perpendicular',
          segmentA: { pointA: 'a', pointB: 'b' },
          segmentB: { pointA: 'b', pointB: 'c' },
        },
      ];

      const result = gradientDescent(
        positionsToState(positionsKeyOrder, positions),
        (input) => getLoss(engineConstraints, stateToPositions(positionsKeyOrder, input)),
        100_000,
      );

      expect(result.converged).toBe(true);

      const resultPositions = stateToPositions(positionsKeyOrder, result.input);
      expect(isInConflict(engineConstraints, resultPositions)).toBe(false);

      expect(distance(resultPositions.get('a')!, resultPositions.get('b')!)).toBeCloseTo(5, 1);
      expect(distance(resultPositions.get('b')!, resultPositions.get('c')!)).toBeCloseTo(5, 1);

      // a-b should be horizontal
      const dy = resultPositions.get('b')!.y - resultPositions.get('a')!.y;
      expect(dy).toBeCloseTo(0, 1);
    });

    it('solves a rectangle with distance, horizontal, and vertical constraints', () => {
      const positionsKeyOrder = ['a', 'b', 'c', 'd'];
      const positions = new Map<string, SheetPosition>();
      positions.set('a', new SheetPosition(5, 0));
      positions.set('b', new SheetPosition(12, 0));
      positions.set('c', new SheetPosition(7, 6));
      positions.set('d', new SheetPosition(0, 5));

      const engineConstraints: Array<EngineConstraint> = [
        { type: 'distance', pointA: 'a', pointB: 'b', targetDistance: 5 },
        { type: 'distance', pointA: 'b', pointB: 'c', targetDistance: 10 },
        { type: 'horizontal', pointA: 'a', pointB: 'b' },
        { type: 'vertical', pointA: 'b', pointB: 'c' },
        { type: 'horizontal', pointA: 'c', pointB: 'd' },
        { type: 'vertical', pointA: 'd', pointB: 'a' },
      ];

      const result = gradientDescent(
        positionsToState(positionsKeyOrder, positions),
        (input) => getLoss(engineConstraints, stateToPositions(positionsKeyOrder, input)),
        100_000,
      );

      expect(result.converged).toBe(true);

      const resultPositions = stateToPositions(positionsKeyOrder, result.input);
      expect(isInConflict(engineConstraints, resultPositions)).toBe(false);

      // Check distances
      expect(distance(resultPositions.get('a')!, resultPositions.get('b')!)).toBeCloseTo(5, 1);
      expect(distance(resultPositions.get('b')!, resultPositions.get('c')!)).toBeCloseTo(10, 1);

      // a-b should be horizontal, b-c vertical, c-d horizontal, d-a vertical
      expect(resultPositions.get('b')!.y - resultPositions.get('a')!.y).toBeCloseTo(0, 1);
      expect(resultPositions.get('c')!.x - resultPositions.get('b')!.x).toBeCloseTo(0, 1);
      expect(resultPositions.get('d')!.y - resultPositions.get('c')!.y).toBeCloseTo(0, 1);
      expect(resultPositions.get('a')!.x - resultPositions.get('d')!.x).toBeCloseTo(0, 1);
    });

    it('solves distanceX constraint while leaving y free', () => {
      const positionsKeyOrder = ['a', 'b'];
      const positions = new Map<string, SheetPosition>();
      positions.set('a', new SheetPosition(0, 5));
      positions.set('b', new SheetPosition(3, 5));

      const engineConstraints: Array<EngineConstraint> = [
        { type: 'distanceX', pointA: 'a', pointB: 'b', targetDistance: 5 },
      ];

      const result = gradientDescent(
        positionsToState(positionsKeyOrder, positions),
        (input) => getLoss(engineConstraints, stateToPositions(positionsKeyOrder, input)),
        100_000,
      );

      expect(result.converged).toBe(true);
      const resultPositions = stateToPositions(positionsKeyOrder, result.input);
      expect(isInConflict(engineConstraints, resultPositions)).toBe(false);

      // x-distance should be 5
      const dx = Math.abs(resultPositions.get('b')!.x - resultPositions.get('a')!.x);
      expect(dx).toBeCloseTo(5, 1);
      // y should remain unchanged (starts equal, solver has no y gradient)
      const dy = Math.abs(resultPositions.get('b')!.y - resultPositions.get('a')!.y);
      expect(dy).toBeCloseTo(0, 1);
    });

    it('solves distanceY constraint while leaving x free', () => {
      const positionsKeyOrder = ['a', 'b'];
      const positions = new Map<string, SheetPosition>();
      positions.set('a', new SheetPosition(5, 0));
      positions.set('b', new SheetPosition(5, 3));

      const engineConstraints: Array<EngineConstraint> = [
        { type: 'distanceY', pointA: 'a', pointB: 'b', targetDistance: 5 },
      ];

      const result = gradientDescent(
        positionsToState(positionsKeyOrder, positions),
        (input) => getLoss(engineConstraints, stateToPositions(positionsKeyOrder, input)),
        100_000,
      );

      expect(result.converged).toBe(true);
      const resultPositions = stateToPositions(positionsKeyOrder, result.input);
      expect(isInConflict(engineConstraints, resultPositions)).toBe(false);

      // y-distance should be 5
      const dy = Math.abs(resultPositions.get('b')!.y - resultPositions.get('a')!.y);
      expect(dy).toBeCloseTo(5, 1);
      // x should remain unchanged
      const dx = Math.abs(resultPositions.get('b')!.x - resultPositions.get('a')!.x);
      expect(dx).toBeCloseTo(0, 1);
    });
  });
});
