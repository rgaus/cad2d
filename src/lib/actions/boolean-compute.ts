import { type Geom, difference, intersection, union } from 'polyclip-ts';
import type { BooleanOperation } from './types';

/**
 * Pure computation for boolean polygon operations.
 * This function has no side effects and can be called from a Web Worker
 * or directly on the main thread.
 */
export function computeBooleanOperation(
  operation: BooleanOperation,
  polygons: Array<Array<[number, number]>>,
): Array<[number, number]> | null {
  const clipPolys = polygons.map((pts) => [pts] as Geom);

  let result: Array<Geom>;
  switch (operation) {
    case 'union': {
      result = union(...(clipPolys as [Geom, Geom]));
      break;
    }
    case 'difference': {
      result = difference(...(clipPolys as [Geom, Geom]));
      break;
    }
    case 'intersection': {
      result = intersection(...(clipPolys as [Geom, Geom]));
      break;
    }
  }

  const firstResult = result[0];
  if (!firstResult || firstResult.length === 0) {
    return null;
  }

  return firstResult[0];
}
