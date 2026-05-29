import { SheetPosition } from "@/lib/viewport/types";
import { distance } from "@/lib/math";

export type PointId = string;

/**
 * Interface that all constraints must implement for the iterative solver.
 * Each constraint represents an energy function that should be minimized.
 * When the constraint is satisfied, the loss/error is zero.
 */
export type EngineConstraintDefinition<Constraint = any> = {
  /**
   * Computes the scalar error value for this constraint.
   * Returns 0 when constraint is satisfied, positive otherwise.
   * Uses the spring energy model: error = 0.5 * (actual - desired)^2
   */
  computeError(constraint: Constraint, pointPositions: Map<PointId, SheetPosition>): number;

  /**
   * Computes the gradient of this constraint's error w.r.t. each point.
   * Returns a Map from pointId to [dx, dy] gradient vector.
   * The gradient points in the direction of steepest ascent.
   */
  computeGradient(constraint: Constraint, pointPositions: Map<PointId, SheetPosition>): Map<PointId, { dx: number; dy: number }>;

  isInConflict(constraint: Constraint, pointPositions: Map<PointId, SheetPosition>): boolean;
};

export type DistanceEngineConstraint = {
  type: "distance";
  pointA: PointId;
  pointB: PointId;
  targetDistance: number;
};

export type FixedPointEngineConstraint = {
  type: "fixedPoint";
  point: PointId;
  position: SheetPosition,
};

export type HorizontalEngineConstraint = {
  type: "horizontal";
  pointA: PointId;
  pointB: PointId;
};

export type VerticalEngingConstraint = {
  type: "vertical";
  pointA: PointId;
  pointB: PointId;
};

export type ParallelEngingConstraint = {
  type: "parallel";
  segmentA: { pointA: PointId; pointB: PointId };
  segmentB: { pointA: PointId; pointB: PointId };
};

export type PerpendicularEngineConstraint = {
  type: "perpendicular";
  segmentA: { pointA: PointId; pointB: PointId };
  segmentB: { pointA: PointId; pointB: PointId };
};

export type EngineConstraint =
  | DistanceEngineConstraint
  | FixedPointEngineConstraint
  | HorizontalEngineConstraint
  | VerticalEngingConstraint
  | ParallelEngingConstraint
  | PerpendicularEngineConstraint;

const ENGINE_CONSTRAINTS_BY_TYPE: Record<EngineConstraint["type"], EngineConstraintDefinition> = {
  distance: {
    computeError(constraint: DistanceEngineConstraint, pointPositions: Map<string, SheetPosition>): number {
      const p1 = pointPositions.get(constraint.pointA);
      const p2 = pointPositions.get(constraint.pointB);

      if (typeof p1 === 'undefined' || typeof p2 === 'undefined') {
        return Infinity;
      }

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);

      const error = currentDistance - constraint.targetDistance;
      return 0.5 * error * error;
    },

    computeGradient(constraint: DistanceEngineConstraint, pointPositions: Map<string, SheetPosition>): Map<string, { dx: number; dy: number }> {
      const p1 = pointPositions.get(constraint.pointA);
      const p2 = pointPositions.get(constraint.pointB);

      const gradients = new Map<string, { dx: number; dy: number }>();

      if (typeof p1 === 'undefined' || typeof p2 === 'undefined') {
        return gradients;
      }

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1e-12) {
        gradients.set(constraint.pointA, { dx: 0, dy: 0 });
        gradients.set(constraint.pointB, { dx: 0, dy: 0 });
        return gradients;
      }

      const error = dist - constraint.targetDistance;
      const gradDist = error / dist;

      gradients.set(constraint.pointA, { dx: gradDist * dx, dy: gradDist * dy });
      gradients.set(constraint.pointB, { dx: -gradDist * dx, dy: -gradDist * dy });

      return gradients;
    },

    isInConflict(constraint: DistanceEngineConstraint, pointPositions: Map<string, SheetPosition>) {
      const p1 = pointPositions.get(constraint.pointA)!;
      const p2 = pointPositions.get(constraint.pointB)!;
      const dist = distance(p1, p2);
      return Math.abs(dist - constraint.targetDistance) > 1e-3;
    },
  } satisfies EngineConstraintDefinition<DistanceEngineConstraint>,

  fixedPoint: {
    computeError(constraint: FixedPointEngineConstraint, pointPositions: Map<string, SheetPosition>): number {
      const p = pointPositions.get(constraint.point);

      if (typeof p === 'undefined') {
        return Infinity;
      }

      const dx = p.x - constraint.position.x;
      const dy = p.y - constraint.position.y;
      return 0.5 * (dx * dx + dy * dy);
    },

    computeGradient(constraint: FixedPointEngineConstraint, pointPositions: Map<string, SheetPosition>): Map<string, { dx: number; dy: number }> {
      const gradients = new Map<string, { dx: number; dy: number }>();
      const p = pointPositions.get(constraint.point);

      if (typeof p === 'undefined') {
        return gradients;
      }

      const dx = p.x - constraint.position.x;
      const dy = p.y - constraint.position.y;

      gradients.set(constraint.point, { dx, dy });

      return gradients;
    },

    isInConflict(constraint: FixedPointEngineConstraint, pointPositions: Map<string, SheetPosition>) {
      const p = pointPositions.get(constraint.point)!;

      const dx = p.x - constraint.position.x;
      const dy = p.y - constraint.position.y;
      return dx > 1e-3 || dy > 1e-3;
    },
  } satisfies EngineConstraintDefinition<FixedPointEngineConstraint>,

  horizontal: {
    computeError(constraint: HorizontalEngineConstraint, pointPositions: Map<string, SheetPosition>): number {
      const start = pointPositions.get(constraint.pointA);
      const end = pointPositions.get(constraint.pointB);

      if (typeof start === 'undefined' || typeof end === 'undefined') {
        return Infinity;
      }

      const dy = end.y - start.y;
      return 0.5 * dy * dy;
    },

    computeGradient(constraint: HorizontalEngineConstraint, pointPositions: Map<string, SheetPosition>): Map<string, { dx: number; dy: number }> {
      const gradients = new Map<string, { dx: number; dy: number }>();
      const start = pointPositions.get(constraint.pointA);
      const end = pointPositions.get(constraint.pointB);

      if (typeof start === 'undefined' || typeof end === 'undefined') {
        return gradients;
      }

      const dy = end.y - start.y;

      // dL/d(start) = -[0, dy]
      // dL/d(end) = [0, dy]
      gradients.set(constraint.pointA, { dx: 0, dy: -dy });
      gradients.set(constraint.pointB, { dx: 0, dy: dy });

      return gradients;
    },

    isInConflict(constraint: HorizontalEngineConstraint, pointPositions: Map<string, SheetPosition>) {
      const start = pointPositions.get(constraint.pointA)!;
      const end = pointPositions.get(constraint.pointB)!;

      const dy = end.y - start.y;
      return dy > 1e-3;
    },
  } satisfies EngineConstraintDefinition<HorizontalEngineConstraint>,

  vertical: {
    computeError(constraint: HorizontalEngineConstraint, pointPositions: Map<string, SheetPosition>): number {
      const start = pointPositions.get(constraint.pointA);
      const end = pointPositions.get(constraint.pointB);

      if (typeof start === 'undefined' || typeof end === 'undefined') {
        return Infinity;
      }

      const dx = end.x - start.x;
      return 0.5 * dx * dx;
    },

    computeGradient(constraint: HorizontalEngineConstraint, pointPositions: Map<string, SheetPosition>): Map<string, { dx: number; dy: number }> {
      const gradients = new Map<string, { dx: number; dy: number }>();
      const start = pointPositions.get(constraint.pointA);
      const end = pointPositions.get(constraint.pointB);

      if (typeof start === 'undefined' || typeof end === 'undefined') {
        return gradients;
      }

      const dx = end.x - start.x;

      // dL/d(start) = -[dx, 0]
      // dL/d(end) = [dx, 0]
      gradients.set(constraint.pointA, { dy: 0, dx: -dx });
      gradients.set(constraint.pointB, { dy: 0, dx: dx });

      return gradients;
    },

    isInConflict(constraint: HorizontalEngineConstraint, pointPositions: Map<string, SheetPosition>) {
      const start = pointPositions.get(constraint.pointA)!;
      const end = pointPositions.get(constraint.pointB)!;

      const dx = end.x - start.x;
      return dx > 1e-3;
    },
  } satisfies EngineConstraintDefinition<HorizontalEngineConstraint>,

  parallel: {
    computeError(constraint: ParallelEngingConstraint, pointPositions: Map<string, SheetPosition>): number {
      const start1 = pointPositions.get(constraint.segmentA.pointA);
      const end1 = pointPositions.get(constraint.segmentA.pointB);
      const start2 = pointPositions.get(constraint.segmentB.pointA);
      const end2 = pointPositions.get(constraint.segmentB.pointB);

      if (typeof start1 === 'undefined' || typeof end1 === 'undefined' ||
          typeof start2 === 'undefined' || typeof end2 === 'undefined') {
        return Infinity;
      }

      const dx1 = end1.x - start1.x;
      const dy1 = end1.y - start1.y;
      const dx2 = end2.x - start2.x;
      const dy2 = end2.y - start2.y;

      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      if (len1 < 1e-12 || len2 < 1e-12) {
        return 0.0;
      }

      const cross = dx1 * dy2 - dy1 * dx2;
      return 0.5 * cross * cross;
    },

    computeGradient(constraint: ParallelEngingConstraint, pointPositions: Map<string, SheetPosition>): Map<string, { dx: number; dy: number }> {
      const gradients = new Map<string, { dx: number; dy: number }>();

      const start1 = pointPositions.get(constraint.segmentA.pointA);
      const end1 = pointPositions.get(constraint.segmentA.pointB);
      const start2 = pointPositions.get(constraint.segmentB.pointA);
      const end2 = pointPositions.get(constraint.segmentB.pointB);

      if (typeof start1 === 'undefined' || typeof end1 === 'undefined' ||
          typeof start2 === 'undefined' || typeof end2 === 'undefined') {
        return gradients;
      }

      const dx1 = end1.x - start1.x;
      const dy1 = end1.y - start1.y;
      const dx2 = end2.x - start2.x;
      const dy2 = end2.y - start2.y;

      const len1Sq = dx1 * dx1 + dy1 * dy1;
      const len2Sq = dx2 * dx2 + dy2 * dy2;
      const len1 = Math.sqrt(len1Sq);
      const len2 = Math.sqrt(len2Sq);

      if (len1 < 1e-12 || len2 < 1e-12) {
        return gradients;
      }

      // Normalized direction vectors
      const dir1x = dx1 / len1;
      const dir1y = dy1 / len1;
      const dir2x = dx2 / len2;
      const dir2y = dy2 / len2;

      // cross product of normalized vectors
      const cross = dir1x * dir2y - dir1y * dir2x;

      // d(cross)/d(dir1_norm) = [dir2y, -dir2x]
      // d(cross)/d(dir2_norm) = [-dir1y, dir1x]
      // d(dir_norm)/d(dir) = (I - dir*dir^T / |dir|²) / |dir|
      // For dir1: (I - [dir1x; dir1y]*[dir1x, dir1y] / len1Sq) / len1
      //   = (1/len1) * [[1 - dir1x², -dir1x*dir1y], [-dir1x*dir1y, 1 - dir1y²]]
      // d(dir)/d(start) = -1, d(dir)/d(end) = +1

      // Gradient for line1 (start1, end1)
      // dL/d(dir1_norm) = cross * [dir2y, -dir2x]
      const gradDir1x = cross * dir2y;
      const gradDir1y = -cross * dir2x;

      // d(dir1_norm)/d(dir1) = (I - dir1*dir1^T / len1Sq) / len1
      const dDir1Norm_dDir1 = (1 / len1) * (1 - (dx1 * dx1) / len1Sq);
      const crossTerm1 = (1 / len1) * (-(dx1 * dy1) / len1Sq);

      // For start1: dL/dstart1 = -gradDir1 * dDir1Norm_dDir1 * dDir1_dStart1
      // The chain is: dL/dstart1 += grad_from_cross * grad_cross_dir1_norm * grad_dir1_norm_dir1 * (-1)
      // dDir1_dStart1 = -1 (since dir1 = end1 - start1)
      const g11 = gradDir1x * dDir1Norm_dDir1 - gradDir1y * crossTerm1;
      const g12 = gradDir1x * crossTerm1 - gradDir1y * dDir1Norm_dDir1;

      gradients.set(constraint.segmentA.pointA, { dx: -g11, dy: -g12 });
      gradients.set(constraint.segmentA.pointB, { dx: g11, dy: g12 });

      // Gradient for line2 (start2, end2)
      // dL/d(dir2_norm) = cross * [-dir1y, dir1x]
      const gradDir2x = -cross * dir1y;
      const gradDir2y = cross * dir1x;

      // d(dir2_norm)/d(dir2) = (I - dir2*dir2^T / len2Sq) / len2
      const dDir2Norm_dDir2 = (1 / len2) * (1 - (dx2 * dx2) / len2Sq);
      const crossTerm2 = (1 / len2) * (-(dx2 * dy2) / len2Sq);

      const g21 = gradDir2x * dDir2Norm_dDir2 - gradDir2y * crossTerm2;
      const g22 = gradDir2x * crossTerm2 - gradDir2y * dDir2Norm_dDir2;

      gradients.set(constraint.segmentB.pointA, { dx: -g21, dy: -g22 });
      gradients.set(constraint.segmentB.pointB, { dx: g21, dy: g22 });

      return gradients;
    },

    isInConflict(constraint: ParallelEngingConstraint, pointPositions: Map<string, SheetPosition>) {
      const start1 = pointPositions.get(constraint.segmentA.pointA)!;
      const end1 = pointPositions.get(constraint.segmentA.pointB)!;
      const start2 = pointPositions.get(constraint.segmentB.pointA)!;
      const end2 = pointPositions.get(constraint.segmentB.pointB)!;

      const dx1 = end1.x - start1.x;
      const dy1 = end1.y - start1.y;
      const dx2 = end2.x - start2.x;
      const dy2 = end2.y - start2.y;

      const cross = dx1 * dy2 - dy1 * dx2;
      return Math.abs(cross) < 1e-3;
    },
  } satisfies EngineConstraintDefinition<ParallelEngingConstraint>,

  perpendicular: {
    computeError(constraint: PerpendicularEngineConstraint, pointPositions: Map<string, SheetPosition>): number {
      const start1 = pointPositions.get(constraint.segmentA.pointA);
      const end1 = pointPositions.get(constraint.segmentA.pointB);
      const start2 = pointPositions.get(constraint.segmentB.pointA);
      const end2 = pointPositions.get(constraint.segmentB.pointB);

      if (typeof start1 === 'undefined' || typeof end1 === 'undefined' ||
          typeof start2 === 'undefined' || typeof end2 === 'undefined') {
        return Infinity;
      }

      const dx1 = end1.x - start1.x;
      const dy1 = end1.y - start1.y;
      const dx2 = end2.x - start2.x;
      const dy2 = end2.y - start2.y;

      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      if (len1 < 1e-12 || len2 < 1e-12) {
        return 0.0;
      }

      const dir1x = dx1 / len1;
      const dir1y = dy1 / len1;
      const dir2x = dx2 / len2;
      const dir2y = dy2 / len2;

      const dot = dir1x * dir2x + dir1y * dir2y;
      return 0.5 * dot * dot;
    },

    computeGradient(constraint: PerpendicularEngineConstraint, pointPositions: Map<string, SheetPosition>): Map<string, { dx: number; dy: number }> {
      const gradients = new Map<string, { dx: number; dy: number }>();

      const start1 = pointPositions.get(constraint.segmentA.pointA);
      const end1 = pointPositions.get(constraint.segmentA.pointB);
      const start2 = pointPositions.get(constraint.segmentB.pointA);
      const end2 = pointPositions.get(constraint.segmentB.pointB);

      if (typeof start1 === 'undefined' || typeof end1 === 'undefined' ||
          typeof start2 === 'undefined' || typeof end2 === 'undefined') {
        return gradients;
      }

      const dx1 = end1.x - start1.x;
      const dy1 = end1.y - start1.y;
      const dx2 = end2.x - start2.x;
      const dy2 = end2.y - start2.y;

      const len1Sq = dx1 * dx1 + dy1 * dy1;
      const len2Sq = dx2 * dx2 + dy2 * dy2;
      const len1 = Math.sqrt(len1Sq);
      const len2 = Math.sqrt(len2Sq);

      if (len1 < 1e-12 || len2 < 1e-12) {
        return gradients;
      }

      const dir1x = dx1 / len1;
      const dir1y = dy1 / len1;
      const dir2x = dx2 / len2;
      const dir2y = dy2 / len2;

      const dot = dir1x * dir2x + dir1y * dir2y;

      // d(dot)/d(dir1_norm) = dir2_norm^T = [dir2x, dir2y]
      // d(dot)/d(dir2_norm) = dir1_norm^T = [dir1x, dir1y]
      // d(dir_norm)/d(dir) = (I - dir*dir^T / |dir|²) / |dir|

      // Gradient for line1
      // dL/d(dir1) = dot * dir2_norm^T * d(dir1_norm)/d(dir1)
      const dDir1Norm_dDir1 = (1 / len1) * (1 - (dx1 * dx1) / len1Sq);
      const crossTerm1 = (1 / len1) * (-(dx1 * dy1) / len1Sq);

      const gradDir1x = dot * dir2x;
      const gradDir1y = dot * dir2y;

      const g11 = gradDir1x * dDir1Norm_dDir1 - gradDir1y * crossTerm1;
      const g12 = gradDir1x * crossTerm1 - gradDir1y * dDir1Norm_dDir1;

      gradients.set(constraint.segmentA.pointA, { dx: -g11, dy: -g12 });
      gradients.set(constraint.segmentA.pointB, { dx: g11, dy: g12 });

      // Gradient for line2
      const dDir2Norm_dDir2 = (1 / len2) * (1 - (dx2 * dx2) / len2Sq);
      const crossTerm2 = (1 / len2) * (-(dx2 * dy2) / len2Sq);

      const gradDir2x = dot * dir1x;
      const gradDir2y = dot * dir1y;

      const g21 = gradDir2x * dDir2Norm_dDir2 - gradDir2y * crossTerm2;
      const g22 = gradDir2x * crossTerm2 - gradDir2y * dDir2Norm_dDir2;

      gradients.set(constraint.segmentB.pointA, { dx: -g21, dy: -g22 });
      gradients.set(constraint.segmentB.pointB, { dx: g21, dy: g22 });

      return gradients;
    },

    isInConflict(constraint: PerpendicularEngineConstraint, pointPositions: Map<string, SheetPosition>) {
      const start1 = pointPositions.get(constraint.segmentA.pointA)!;
      const end1 = pointPositions.get(constraint.segmentA.pointB)!;
      const start2 = pointPositions.get(constraint.segmentB.pointA)!;
      const end2 = pointPositions.get(constraint.segmentB.pointB)!;

      const dx1 = end1.x - start1.x;
      const dy1 = end1.y - start1.y;
      const dx2 = end2.x - start2.x;
      const dy2 = end2.y - start2.y;

      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      return len1 < 1e-3 || len2 < 1e-3;
    },
  } satisfies EngineConstraintDefinition<PerpendicularEngineConstraint>,
};


export function getLoss(engineConstraints: Array<EngineConstraint>, positions: Map<string, SheetPosition>): number {
  let totalLoss = 0;
  for (const constraint of engineConstraints) {
    const impl = ENGINE_CONSTRAINTS_BY_TYPE[constraint.type];
    totalLoss += impl.computeError(constraint, positions);
  }
  return totalLoss;
}

/**
 * Computes the numerical gradient of the loss function with respect to each
 * input element using central differences: (f(x+h) - f(x-h)) / (2h).
 */
function computeGradient(
  input: Array<number>,
  getLoss: (input: Array<number>) => number,
  epsilon: number
): Array<number> {
  const gradient: Array<number> = new Array(input.length).fill(0);

  for (const [i] of input.entries()) {
    // Perturb the i-th element positively and negatively
    const inputPlus = [...input];
    const inputMinus = [...input];
    inputPlus[i] += epsilon;
    inputMinus[i] -= epsilon;

    gradient[i] = (getLoss(inputPlus) - getLoss(inputMinus)) / (2 * epsilon);
  }

  return gradient;
}

type GradientDescentOptions = {
  learningRate?: number;
  // Step size for numerical gradient estimation
  epsilon?: number;
};

type GradientDescentResult = {
  converged: boolean;
  input: Array<number>;
  loss: number;
  iterations: number;
};

/**
 * Runs gradient descent on a black-box loss function for a fixed number of
 * iterations, using numerical differentiation to estimate gradients.
 *
 * The algorithm tries to drive getLoss(input) as close to zero as possible
 * by stepping each input element against its gradient direction.
 */
export function gradientDescent(
  initialInput: Array<number>,
  getLoss: (input: Array<number>) => number,
  numIterations: number,
  options: GradientDescentOptions = {}
): GradientDescentResult {
  const learningRate = options.learningRate ?? 0.01;
  const epsilon = options.epsilon ?? 1e-5;

  // Work on a copy so we don't mutate the caller's array
  let input = [...initialInput];

  for (let iter = 0; iter < numIterations; iter += 1) {
    const loss = getLoss(input);

    // Early exit if we're already at (or extremely near) zero
    if (Math.abs(loss) < 1e-10) {
      return { converged: true, input, loss, iterations: iter };
    }

    const gradient = computeGradient(input, getLoss, epsilon);

    // Step each element in the direction that reduces loss
    for (const [i] of input.entries()) {
      input[i] -= learningRate * gradient[i];
    }
  }

  return { converged: false, input, loss: getLoss(input), iterations: numIterations };
}

export function generatePositionsKeyOrder(positions: Map<PointId, SheetPosition>) {
  return Array.from(positions.keys());
}

export function positionsToState(positionsKeyOrder: Array<PointId>, positions: Map<PointId, SheetPosition>) {
  const state = [];
  for (const key of positionsKeyOrder) {
    const pos = positions.get(key);
    if (!pos) {
      continue;
    }
    state.push(pos.x);
    state.push(pos.y);
  }
  return state;
}

export function stateToPositions(positionsKeyOrder: Array<PointId>, state: Array<number>) {
  const positions = new Map<PointId, SheetPosition>();
  for (let i = 0; i < positionsKeyOrder.length; i += 1) {
    const key = positionsKeyOrder[i];
    positions.set(key, new SheetPosition(state[i * 2], state[i * 2 + 1]));
  }
  return positions;
}

export function isInConflict(engineConstraints: Array<EngineConstraint>, positions: Map<PointId, SheetPosition>) {
  for (const c of engineConstraints) {
    if (ENGINE_CONSTRAINTS_BY_TYPE[c.type].isInConflict(c, positions)) {
      console.log('in conflift?', c);
      return true;
    }
  }
  return false;
}




