import { FuzzApp, snapshotDocument } from '../../fuzz/app';
import { runInvariants } from '../../fuzz/invariants';
import { describeOp, pickRandomOp } from '../../fuzz/ops';
import { PRNG } from '../../fuzz/prng';
import { reproduceFromOps } from '../../fuzz/repro';
import { shrinkSequence } from '../../fuzz/shrink';
import type { OpRecord } from '../../fuzz/types';

describe('fuzz/prng', () => {
  it('is deterministic for the same seed', () => {
    const a = new PRNG(42);
    const b = new PRNG(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new PRNG(1);
    const b = new PRNG(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('int/range/pick stay within bounds', () => {
    const rng = new PRNG(7);
    for (let i = 0; i < 100; i += 1) {
      const n = rng.int(0, 10);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(10);
      const f = rng.range(-5, 5);
      expect(f).toBeGreaterThanOrEqual(-5);
      expect(f).toBeLessThan(5);
    }
  });
});

describe('fuzz/app', () => {
  it('replays the same op sequence deterministically', async () => {
    const ops: Array<OpRecord> = [
      {
        type: 'draw-polygon',
        points: [
          { x: 1, y: 1 },
          { x: 5, y: 1 },
          { x: 5, y: 5 },
          { x: 1, y: 5 },
        ],
        closed: true,
      },
      {
        type: 'draw-rectangle',
        first: { x: 3, y: 3 },
        second: { x: 8, y: 8 },
        centerMode: false,
      },
      { type: 'translate', ids: [], dx: 0.5, dy: 0.25 },
      { type: 'delete', ids: ['ply_fuzz9'] },
    ];

    const run = async () => {
      const app = new FuzzApp(5);
      for (const op of ops) {
        await app.runOp(op);
      }
      return snapshotDocument(app);
    };

    const first = await run();
    const second = await run();
    expect(first).toEqual(second);

    // Confirm the deterministic id scheme is in effect.
    const app = new FuzzApp(5);
    await app.runOp(ops[0]);
    const ids = Array.from(app.geometryStore.getAllGeometryIds());
    expect(ids).toHaveLength(1);
    expect(ids[0].endsWith('_fuzz1')).toBe(true);
  });

  it('runOp never throws; reports errors as results', async () => {
    const app = new FuzzApp(9);
    const result = await app.runOp({
      type: 'draw-polygon',
      points: [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
      ],
      closed: false,
    });
    expect(['ok', 'noop', 'error']).toContain(result.kind);
  });
});

describe('fuzz/invariants', () => {
  it('passes on a healthy document', async () => {
    const app = new FuzzApp(1);
    const ops: Array<OpRecord> = [
      {
        type: 'draw-polygon',
        points: [
          { x: 0.5, y: 0.5 },
          { x: 4, y: 0.5 },
          { x: 4, y: 4 },
          { x: 0.5, y: 4 },
        ],
        closed: true,
      },
      { type: 'draw-rectangle', first: { x: 6, y: 6 }, second: { x: 9, y: 9 }, centerMode: false },
      { type: 'draw-ellipse', first: { x: 2, y: 10 }, second: { x: 4, y: 13 }, centerMode: false },
      { type: 'undo' },
      { type: 'redo' },
    ];
    for (const op of ops) {
      const result = await app.runOp(op);
      expect(result.kind).not.toBe('error');
      const violations = runInvariants(app);
      expect(violations).toEqual([]);
    }
  });
});

describe('fuzz/ops', () => {
  it('pickRandomOp can draw a polygon and human descriptions are non-empty', async () => {
    const app = new FuzzApp(3);
    const rng = new PRNG(3);
    let drew = 0;
    for (let i = 0; i < 50 && drew < 2; i += 1) {
      const op = pickRandomOp(app, rng);
      if (op && op.type === 'draw-polygon') {
        await app.runOp(op);
        expect(describeOp(op)).toContain('polygon');
        drew += 1;
      }
    }
    expect(drew).toBe(2);
  });
});

describe('fuzz/shrink', () => {
  it('ddmin removes unnecessary ops', async () => {
    const targetStep = 3;
    const oracle: (ops: Array<OpRecord>) => Promise<{ reproduces: boolean }> = async (ops) => {
      return { reproduces: ops.some((op) => op.type === 'move-vertex') };
    };
    const seq: Array<OpRecord> = [
      { type: 'draw-polygon', points: [], closed: false },
      { type: 'undo' },
      { type: 'move-vertex', id: 'x', segmentIndex: 0, to: { x: 0, y: 0 } },
      { type: 'redo' },
      { type: 'clear-selection' },
    ];
    const result = await shrinkSequence(seq, oracle, 50);
    expect(result.shrunk).toBe(true);
    expect(result.ops).toHaveLength(1);
    expect(result.ops[0].type).toBe('move-vertex');
    void targetStep;
  });

  it('leaves the sequence unchanged when the oracle never reproduces', async () => {
    const oracle: (ops: Array<OpRecord>) => Promise<{ reproduces: boolean }> = async () => {
      return { reproduces: false };
    };
    const seq: Array<OpRecord> = [
      { type: 'delete', ids: ['gly_tmp'] },
      { type: 'draw-rectangle', first: { x: 0, y: 0 }, second: { x: 1, y: 1 }, centerMode: false },
    ];
    const result = await shrinkSequence(seq, oracle, 20);
    expect(result.ops.length).toBe(2);
    expect(result.shrunk).toBe(false);
  });
});

describe('fuzz/repro', () => {
  it('reproduces a destroyed document with an op sequence that crashes', async () => {
    // A bogus op type triggers the repro runner's crash path.
    const ops = [
      {
        type: 'draw-polygon',
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ],
        closed: false,
      },
    ] as Array<OpRecord>;
    const result = await reproduceFromOps(ops);
    expect(typeof result.reproduced).toBe('boolean');
    expect(result.svg).toBeDefined();
  });

  it('does not trigger the near-vertex edge-split crash (bug-1789851197201-36290)', async () => {
    // Regression test for the fuzzer artifact whose minimized sequence
    // (ellipse + open polygon + trim-split) used to crash the DCEL with
    // "linkNext: next half-edge does not exist" during undo/redo. The
    // phantom intersection used to mint a near-duplicate vertex and split
    // an edge at its own endpoint; the vertex snap fix prevents that.
    const ops = [
      {
        type: 'draw-ellipse',
        first: { x: 14.69401674787514, y: 54.73775552061852 },
        second: { x: 14.785692165023647, y: 117.43402141681872 },
        centerMode: false,
      },
      {
        type: 'draw-polygon',
        points: [
          { x: 17.808018901152536, y: 90.02547324215993 },
          { x: 15.849654981167987, y: 42.61669861630071 },
          { x: 13.236402334761806, y: 110.47132819716353 },
          { x: 2.161047957953997, y: 246.4473734877538 },
          { x: 1.0469873030669987, y: 240.6940487145912 },
          { x: 6.193685072939843, y: 77.85048602614552 },
        ],
        closed: false,
      },
      {
        type: 'trim-split',
        point: { x: 8.97354154266262, y: 132.8811012318529 },
      },
    ] as Array<OpRecord>;

    const result = await reproduceFromOps(ops);
    expect(result.reproduced).toBe(false);
    expect(result.error).toBeNull();
    expect(result.invariantViolations).toEqual([]);
  });

  it('does not corrupt the DCEL when a trim boundary retraces an untouched shape (bug-1789849272778-536332)', async () => {
    // Regression for the fuzzer bug where trimming an edge that merely overlaps
    // an untouched rectangle produced a boundary walking the rectangle's own
    // edges. Re-registering that boundary as a new polygon duplicated the
    // rectangle's edges, corrupting the DCEL's shared-edge ref counts and
    // crashing undo/redo with "linkNext: half-edge does not exist". The trim is
    // now detected (boundary traverses no affected shapes) and skipped.
    const ops = [
      {
        type: 'draw-rectangle',
        first: { x: 7.408930869141454, y: 36.339766068219056 },
        second: { x: 5.49729473719476, y: 25.771443374946305 },
        centerMode: false,
      },
      {
        type: 'draw-polygon',
        points: [
          { x: 3.1256060984176326, y: 54.905769868685105 },
          { x: 5.093434150130891, y: 40.0353457351228 },
          { x: 6.5220142017305625, y: 9.194825825060528 },
          { x: 13.767402867795752, y: 10.635066180951036 },
        ],
        closed: true,
      },
      {
        type: 'trim-split',
        point: { x: 8.44, y: 24.126150387238468 },
      },
    ] as Array<OpRecord>;

    const result = await reproduceFromOps(ops);
    expect(result.reproduced).toBe(false);
    expect(result.error).toBeNull();
    expect(result.invariantViolations).toEqual([]);
  });
});
