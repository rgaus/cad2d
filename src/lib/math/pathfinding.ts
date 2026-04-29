import type { Position } from "../viewport/types";

/**
 * Manhattan distance between two positions.
 * Used as a heuristic for A* pathfinding since it's faster than Euclidean (no sqrt).
 */
export function manhattanDistance<P extends Position>(a: P, b: P): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Edge representation for A* pathfinding.
 * Contains the neighbor node and the cost to traverse to it.
 */
export interface PathNode<T> {
  node: T;
  cost: number;
}

/**
 * A* pathfinding algorithm.
 *
 * @param start - The starting node.
 * @param end - The target node.
 * @param getNeighbors - Function that returns all reachable neighbors and their traversal costs.
 * @param heuristic - Heuristic function (estimated cost from node to end). Must be admissible (never overestimate).
 * @returns Array of nodes representing the path from start to end, or null if no path exists.
 */
export function astar<T>(
  start: T,
  end: T,
  getNeighbors: (node: T) => Array<PathNode<T>>,
  heuristic: (node: T) => number,
): Array<T> | null {
  if (start === end) {
    return [start];
  }

  // Priority queue: node -> fScore
  const openSet = new Map<T, number>();
  openSet.set(start, heuristic(start));

  // Track where we came from
  const cameFrom = new Map<T, T>();

  // gScore: cost from start to this node
  const gScore = new Map<T, number>();
  gScore.set(start, 0);

  // Track best known fScore for each node in open set
  const fScore = new Map<T, number>();
  fScore.set(start, heuristic(start));

  while (openSet.size > 0) {
    // Get node with lowest fScore from openSet
    let current: T | null = null;
    let currentF = Infinity;
    for (const [node, f] of openSet) {
      if (f < currentF) {
        currentF = f;
        current = node;
      }
    }

    if (current === null) {
      break;
    }

    // Check if we reached the goal
    if (current === end) {
      return reconstructPath(cameFrom, current);
    }

    // Remove current from open set
    openSet.delete(current);
    const currentG = gScore.get(current)!;

    // Explore neighbors
    for (const neighborInfo of getNeighbors(current)) {
      const neighbor = neighborInfo.node;
      const tentativeG = currentG + neighborInfo.cost;

      const existingG = gScore.get(neighbor);
      if (typeof existingG === 'undefined' || tentativeG < existingG) {
        // Found a better path to this neighbor
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeG);
        fScore.set(neighbor, tentativeG + heuristic(neighbor));
        openSet.set(neighbor, tentativeG + heuristic(neighbor));
      }
    }
  }

  // No path found
  return null;
}

/**
 * Reconstructs the path from the cameFrom map.
 */
function reconstructPath<T>(cameFrom: Map<T, T>, end: T): Array<T> {
  const path = [end];
  let current: T | undefined = end;
  while (true) {
    const prev = cameFrom.get(current);
    if (typeof prev === 'undefined') {
      break;
    }
    path.unshift(prev);
    current = prev;
  }
  return path;
}