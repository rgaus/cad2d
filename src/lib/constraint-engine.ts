import { SheetPosition } from "@/lib/viewport/types";
import { GeometryStore } from "@/lib/tools/GeometryStore";
import { UnitType } from "./units/length";
import { distance } from "./math";

type PointId = string;

/**
 * Interface that all constraints must implement for the iterative solver.
 * Each constraint represents an energy function that should be minimized.
 * When the constraint is satisfied, the loss/error is zero.
 */
type EngineConstraintDefinition<Constraint = any> = {
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
};

type DistanceEngineConstraint = {
  type: "distance";
  pointA: PointId;
  pointB: PointId;
  targetDistance: number;
};

type FixedPointConstraint = {
  type: "fixedPoint";
  point: PointId;
  position: SheetPosition,
};

type HorizontalConstraint = {
  type: "horizontal";
  pointA: PointId;
  pointB: PointId;
};

type EngineConstraint = DistanceEngineConstraint | FixedPointConstraint | HorizontalConstraint;

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
  } satisfies EngineConstraintDefinition<DistanceEngineConstraint>,

  fixedPoint: {
    computeError(constraint: FixedPointConstraint, pointPositions: Map<string, SheetPosition>): number {
      const p = pointPositions.get(constraint.point);

      if (typeof p === 'undefined') {
        return Infinity;
      }

      const dx = p.x - constraint.position.x;
      const dy = p.y - constraint.position.y;
      return 0.5 * (dx * dx + dy * dy);
    },

    computeGradient(constraint: FixedPointConstraint, pointPositions: Map<string, SheetPosition>): Map<string, { dx: number; dy: number }> {
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
  } satisfies EngineConstraintDefinition<FixedPointConstraint>,

  horizontal: {
    computeError(constraint: HorizontalConstraint, pointPositions: Map<string, SheetPosition>): number {
      const start = pointPositions.get(constraint.pointA);
      const end = pointPositions.get(constraint.pointB);

      if (typeof start === 'undefined' || typeof end === 'undefined') {
        return Infinity;
      }

      const dy = end.y - start.y;
      return 0.5 * dy * dy;
    },

    computeGradient(constraint: HorizontalConstraint, pointPositions: Map<string, SheetPosition>): Map<string, { dx: number; dy: number }> {
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
  } satisfies EngineConstraintDefinition<HorizontalConstraint>,
};


function getLoss(engineConstraints: Array<EngineConstraint>, positions: Map<string, SheetPosition>): number {
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
  success: boolean;
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
function gradientDescent(
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
      return { success: true, input, loss, iterations: iter };
    }

    const gradient = computeGradient(input, getLoss, epsilon);

    // Step each element in the direction that reduces loss
    for (const [i] of input.entries()) {
      input[i] -= learningRate * gradient[i];
    }
  }

  return { success: false, input, loss: getLoss(input), iterations: numIterations };
}

function generateEngineConstraints(geometryStore: GeometryStore, sheetUnits: UnitType) {
  const positions = new Map<PointId, SheetPosition>();
  const positionsKeyOrder: Array<PointId> = [];
  const addPosition = (key: PointId, value: SheetPosition) => {
    positions.set(key, value);
    positionsKeyOrder.push(key);
  };

  const engineConstraints: Array<EngineConstraint> = [];

  for (const constraint of geometryStore.constraints) {
    switch (constraint.type) {
      case "linear":
        addPosition(`${constraint.id}-a`, constraint.pointA);
        addPosition(`${constraint.id}-b`, constraint.pointB);
        engineConstraints.push({
          type: "distance",
          pointA: `${constraint.id}-a`,
          pointB: `${constraint.id}-b`,
          targetDistance: constraint.constrainedLength.toSheetUnits(sheetUnits).magnitude,
        });
        break;
    }
  }

  return { positions, positionsKeyOrder, engineConstraints };
}

function positionsToState(positionsKeyOrder: Array<PointId>, positions: Map<PointId, SheetPosition>) {
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

function stateToPositions(positionsKeyOrder: Array<PointId>, state: Array<number>) {
  const positions = new Map<PointId, SheetPosition>();
  for (let i = 0; i < positionsKeyOrder.length; i += 1) {
    const key = positionsKeyOrder[i];
    positions.set(key, new SheetPosition(state[i * 2], state[i * 2 + 1]));
  }
  return positions;
}

type EvaluateConstraintsOptions = GradientDescentOptions & {
  iterations?: number;
};

export function evaluateConstraints(geometryStore: GeometryStore, sheetUnits: UnitType, opts?: EvaluateConstraintsOptions) {
  const { positions, positionsKeyOrder, engineConstraints } = generateEngineConstraints(geometryStore, sheetUnits);

  const result = gradientDescent(
    positionsToState(positionsKeyOrder, positions),
    (input) => getLoss(engineConstraints, stateToPositions(positionsKeyOrder, input)),
    opts?.iterations ?? 100000,
    opts,
  );

  const resultPositions = stateToPositions(positionsKeyOrder, result.input);
  console.log('RESULT:', resultPositions);
}





export function test() {
  const positionsKeyOrder = ["a", "b", "c"];
  const positions = new Map<string, SheetPosition>();
  positions.set("a", new SheetPosition(5, 0));
  positions.set("b", new SheetPosition(12, 0));
  positions.set("c", new SheetPosition(7, 6));

  const engineConstraints: Array<EngineConstraint> = [
    { type: "distance", pointA: "a", pointB: "b", targetDistance: 5 },
    { type: "distance", pointA: "b", pointB: "c", targetDistance: 5 },
    { type: "distance", pointA: "c", pointB: "a", targetDistance: 5 },
    { type: "horizontal", pointA: "a", pointB: "b" },
  ];

  const result = gradientDescent(
    positionsToState(positionsKeyOrder, positions),
    (input) => getLoss(engineConstraints, stateToPositions(positionsKeyOrder, input)),
    100_000,
  );
  console.log('Input:', positions);
  console.log('Success?', result.success);

  const resultPositions = stateToPositions(positionsKeyOrder, result.input);
  console.log('Result:', resultPositions);

  console.log('distance a -> c:', distance(resultPositions.get('a')!, resultPositions.get('b')!));
  console.log('distance b -> c:', distance(resultPositions.get('b')!, resultPositions.get('c')!));
  console.log('distance c -> a:', distance(resultPositions.get('c')!, resultPositions.get('a')!));
}
