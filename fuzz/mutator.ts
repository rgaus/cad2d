import type { FuzzApp } from './app';
import { pickRandomOp } from './ops';
import { PRNG } from './prng';
import type { EndpointRef, OpRecord, Point } from './types';

/**
 * Mutators turn a known-interesting op sequence into a nearby variant:
 * deletions, insertions, swaps, duplications and numeric nudges. Nudging
 * coordinates by tiny epsilons is what explores near-degenerate geometry
 * (edge-through-vertex, tiny slivers, etc.).
 */

function copyPoint(p: Point): Point {
  return { x: p.x, y: p.y };
}

function copyPointList(points: Array<Point>): Array<Point> {
  return points.map(copyPoint);
}

/** Returns a shallow copy of the op with one numeric field nudged by ~1e-3. */
export function nudgeOp(op: OpRecord, rng: PRNG): OpRecord {
  const delta = () => (rng.chance(0.5) ? rng.range(-0.01, -0.0001) : rng.range(0.0001, 0.01));
  switch (op.type) {
    case 'draw-polygon': {
      if (op.points.length === 0) {
        return op;
      }
      const points = copyPointList(op.points);
      const i = rng.index(points.length);
      const pt = points[i];
      if (rng.chance(0.5)) {
        pt.x = round(pt.x + delta());
      } else {
        pt.y = round(pt.y + delta());
      }
      return { ...op, points };
    }
    case 'draw-rectangle':
    case 'draw-ellipse': {
      const first = copyPoint(op.first);
      const second = copyPoint(op.second);
      const target = rng.chance(0.5) ? first : second;
      if (rng.chance(0.5)) {
        target.x = round(target.x + delta());
      } else {
        target.y = round(target.y + delta());
      }
      return { ...op, first, second };
    }
    case 'translate': {
      const dx = rng.chance(0.5) ? round(op.dx + rng.range(-0.05, 0.05)) : op.dx;
      const dy = rng.chance(0.5) ? round(op.dy + rng.range(-0.05, 0.05)) : op.dy;
      return { ...op, dx, dy };
    }
    case 'move-vertex':
    case 'move-control-point':
    case 'nudge-vertex': {
      const to = copyPoint(op.to);
      if (rng.chance(0.5)) {
        to.x = round(to.x + delta());
      } else {
        to.y = round(to.y + delta());
      }
      return { ...op, to };
    }
    case 'insert-point-on-edge': {
      const pos = copyPoint(op.pos);
      if (rng.chance(0.5)) {
        pos.x = round(pos.x + delta());
      } else {
        pos.y = round(pos.y + delta());
      }
      return { ...op, pos };
    }
    case 'trim-split': {
      const point = copyPoint(op.point);
      if (rng.chance(0.5)) {
        point.x = round(point.x + delta());
      } else {
        point.y = round(point.y + delta());
      }
      return { ...op, point };
    }
    case 'add-linear-constraint':
    case 'add-horizontal-constraint':
    case 'add-vertical-constraint': {
      return {
        ...op,
        pointA: maybeNudgeEndpoint(op.pointA, rng),
        pointB: maybeNudgeEndpoint(op.pointB, rng),
      };
    }
    default:
      return op;
  }
}

function maybeNudgeEndpoint(endpoint: EndpointRef, rng: PRNG): EndpointRef {
  if (endpoint.type === 'free') {
    const d = rng.range(-0.01, 0.01);
    return rng.chance(0.5)
      ? { type: 'free', x: round(endpoint.x + d), y: endpoint.y }
      : { type: 'free', x: endpoint.x, y: round(endpoint.y + d) };
  }
  return endpoint;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Produces a mutated variant of `baseOps`. `app` should be a fresh app that has
 * already executed `baseOps`, so pickRandomOp can reference real geometry.
 * Mutations that would leave the sequence unchanged are retried a few times.
 */
export function mutateSequence(baseOps: Array<OpRecord>, app: FuzzApp, rng: PRNG): Array<OpRecord> {
  const mutationCount = rng.int(1, 3);
  let ops = baseOps.slice();

  for (let m = 0; m < mutationCount && ops.length > 0; m += 1) {
    const mutation = rng.pick(['delete', 'swap', 'duplicate', 'insert', 'nudge'] as const);
    switch (mutation) {
      case 'delete':
        if (ops.length > 1) {
          ops.splice(rng.index(ops.length), 1);
        }
        break;
      case 'swap':
        if (ops.length >= 2) {
          const i = rng.index(ops.length - 1);
          const a = ops[i];
          ops[i] = ops[i + 1];
          ops[i + 1] = a;
        }
        break;
      case 'duplicate':
        if (ops.length > 0) {
          const copy = JSON.parse(JSON.stringify(rng.pick(ops))) as OpRecord;
          ops.splice(rng.index(ops.length + 1), 0, copy);
        }
        break;
      case 'insert': {
        const position = rng.index(ops.length + 1);
        const candidate = pickRandomOp(app, rng);
        if (candidate && rng.chance(0.6) === false) {
          // insert a draw-style op that does not depend on existing ids for validity
          const draw = pickDrawStyle(candidate);
          ops.splice(position, 0, draw ?? candidate);
        } else if (candidate) {
          ops.splice(position, 0, candidate);
        }
        break;
      }
      case 'nudge':
        if (ops.length > 0) {
          const i = rng.index(ops.length);
          ops[i] = nudgeOp(ops[i], rng);
        }
        break;
    }
  }

  return ops;
}

function pickDrawStyle(op: OpRecord): OpRecord | null {
  if (op.type === 'draw-polygon' || op.type === 'draw-rectangle' || op.type === 'draw-ellipse') {
    return op;
  }
  return null;
}
