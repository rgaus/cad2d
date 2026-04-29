import { manhattanDistance, astar } from '../lib/math/pathfinding';
import { SheetPosition } from '../lib/viewport/types';

describe('manhattanDistance', () => {
  it('returns correct distance between two points', () => {
    const a = new SheetPosition(0, 0);
    const b = new SheetPosition(3, 4);
    expect(manhattanDistance(a, b)).toBe(7);
  });

  it('returns 0 for same point', () => {
    const a = new SheetPosition(5, 5);
    expect(manhattanDistance(a, a)).toBe(0);
  });

  it('handles negative coordinates', () => {
    const a = new SheetPosition(-3, -5);
    const b = new SheetPosition(2, 7);
    expect(manhattanDistance(a, b)).toBe(17);
  });

  it('is symmetric', () => {
    const a = new SheetPosition(1, 2);
    const b = new SheetPosition(5, 8);
    expect(manhattanDistance(a, b)).toBe(manhattanDistance(b, a));
  });
});

describe('astar', () => {
  it('returns single node path when start equals end', () => {
    const result = astar('A', 'A', () => [], () => 0);
    expect(result).toEqual(['A']);
  });

  it('returns direct path between two nodes', () => {
    const graph: Record<string, Array<{ node: string; cost: number }>> = {
      A: [{ node: 'B', cost: 1 }],
      B: [{ node: 'A', cost: 1 }, { node: 'C', cost: 1 }],
      C: [{ node: 'B', cost: 1 }],
    };

    const getNeighbors = (node: string) => graph[node] || [];
    const heuristic = (_node: string) => 1;

    const result = astar('A', 'C', getNeighbors, heuristic);
    expect(result).toEqual(['A', 'B', 'C']);
  });

  it('finds shortest path through multiple nodes', () => {
    const graph: Record<string, Array<{ node: string; cost: number }>> = {
      A: [{ node: 'B', cost: 1 }],
      B: [{ node: 'C', cost: 1 }, { node: 'D', cost: 2 }],
      C: [{ node: 'E', cost: 1 }],
      D: [{ node: 'E', cost: 1 }],
      E: [],
    };

    const getNeighbors = (node: string) => graph[node] || [];
    const heuristic = () => 1;

    const result = astar('A', 'E', getNeighbors, heuristic);
    expect(result).toEqual(['A', 'B', 'C', 'E']);
  });

  it('returns null when no path exists', () => {
    const graph: Record<string, Array<{ node: string; cost: number }>> = {
      A: [{ node: 'B', cost: 1 }],
      B: [{ node: 'A', cost: 1 }],
      C: [{ node: 'D', cost: 1 }],
      D: [{ node: 'C', cost: 1 }],
    };

    const getNeighbors = (node: string) => graph[node] || [];
    const heuristic = () => 1;

    const result = astar('A', 'D', getNeighbors, heuristic);
    expect(result).toBeNull();
  });

  it('uses edge costs in pathfinding', () => {
    const graph: Record<string, Array<{ node: string; cost: number }>> = {
      A: [{ node: 'B', cost: 10 }, { node: 'C', cost: 1 }],
      B: [{ node: 'D', cost: 1 }],
      C: [{ node: 'D', cost: 1 }],
      D: [],
    };

    const getNeighbors = (node: string) => graph[node] || [];
    const heuristic = () => 1;

    const result = astar('A', 'D', getNeighbors, heuristic);
    expect(result).toEqual(['A', 'C', 'D']);
  });

  it('uses heuristic to guide search', () => {
    const graph: Record<string, Array<{ node: string; cost: number }>> = {
      A: [{ node: 'B', cost: 1 }, { node: 'C', cost: 1 }],
      B: [{ node: 'D', cost: 1 }],
      C: [{ node: 'D', cost: 10 }],
      D: [],
    };

    const getNeighbors = (node: string) => graph[node] || [];
    const heuristic = (node: string) => (node === 'D' ? 0 : 1);

    const result = astar('A', 'D', getNeighbors, heuristic);
    expect(result).toEqual(['A', 'B', 'D']);
  });

  it('handles isolated node (no neighbors)', () => {
    const getNeighbors = (_node: string) => [];
    const heuristic = () => 1;

    const result = astar('A', 'B', getNeighbors, heuristic);
    expect(result).toBeNull();
  });

  it('handles complex graph with cycles', () => {
    const graph: Record<string, Array<{ node: string; cost: number }>> = {
      A: [{ node: 'B', cost: 1 }, { node: 'C', cost: 1 }],
      B: [{ node: 'A', cost: 1 }, { node: 'D', cost: 1 }],
      C: [{ node: 'A', cost: 1 }, { node: 'D', cost: 1 }],
      D: [{ node: 'B', cost: 1 }, { node: 'C', cost: 1 }, { node: 'E', cost: 1 }],
      E: [{ node: 'D', cost: 1 }],
    };

    const getNeighbors = (node: string) => graph[node] || [];
    const heuristic = () => 1;

    const result = astar('A', 'E', getNeighbors, heuristic);
    expect(result).toEqual(['A', 'B', 'D', 'E']);
  });
});