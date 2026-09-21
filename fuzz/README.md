# Cad2d fuzz harness

A headless fuzzer for the cad2d core. It drives the real app classes
(`Sheet`, `GeometryStore`, `HistoryManager`, `ToolManager`, `ActionsManager`,
`SerializationManager`) with simulated user operations - no browser, no Pixi -
and uses a three-tier oracle to detect bugs:

1. **Crash** - any op that throws is an immediate bug (per-op, free).
2. **Invariant** - cheap structural checks after every op (per-op, free):
   no NaN geometry, valid selection, no leftover working shapes, serialization
   health, and an `undo()` + `redo()` round-trip consistency check.
3. **LLM judge** - every `--check-every` ops the LLM inspects the operation log
   - SVG export + structured geometry dump and flags sessions that "look wrong".

When a bug is found the sequence is **shrunk** (ddmin chunk deletion against a
replay oracle), then logged to `fuzz/artifacts/<case>/` with the minimized op
sequence, the full sequence, the doc state, and the SVG export.

The fuzzer also mixes in **LLM-guided seeds**: with `--prompt`, the LLM produces
initial op sequences targeting the requested scenario (e.g. "an edge that passes
exactly through a vertex of another shape"). Those seeds populate `fuzz/corpus/`,
and workers mutate known-interesting corpus entries (delete/insert/swap/nudge
epsilon) to explore nearby regions. Found-bug sequences are appended to the
corpus so all workers converge on interesting geometry.

## Layout

```
fuzz/
  cli.ts           argument parsing + spawns one worker process per thread
  worker-entry.ts  worker process entrypoint (reads config from env)
  worker.ts        the fuzz loop: runs walks, classifies + shrinks + logs bugs
  app.ts           headless core harness (FuzzApp) + document snapshot
  ops.ts           the op vocabulary: executeOp / describeOp / pickRandomOp
  invariants.ts    Tier-1 oracle
  judge.ts         Tier-3 LLM oracle (generic judge + targeted symptom judge)
  generator.ts     LLM seed-sequence generation (the --prompt feature)
  mutator.ts       seed mutation (delete/insert/swap/nudge/duplicate)
  shrink.ts        ddmin shrinker
  repro.ts         replay an artifact and check if the bug reproduces
  corpus.ts        corpus read/write helpers
  llm.ts           OpenAI-compatible chat client (opencode go by default)
  prng.ts          seeded PRNG
  types.ts         OpRecord / CorpusEntry / config types
  artifacts/       bug reports (written at runtime)
  corpus/          interesting sequences (written at runtime)
```

## Running

```bash
# LLM tested locally first; judge/seed features need an API key
FUZZ_LLM_API_KEY=sk-... npx tsx fuzz/cli.ts run --threads 4 --check-every 20 --duration 300

# Crash/invariant-only fuzzing (no LLM)
npx tsx fuzz/cli.ts run --threads 4 --duration 300 --llm off

# Seed the corpus with an LLM for a scenario
npx tsx fuzz/cli.ts gen --prompt "an edge that passes exactly through a vertex of another shape"

# Replay a bug report to check it reproduces
npx tsx fuzz/cli.ts repro fuzz/artifacts/bug-12345
```

Options for `run`:

| option          | default        | meaning                                   |
| --------------- | -------------- | ----------------------------------------- |
| `--threads`     | 1              | parallel worker processes                 |
| `--check-every` | 20             | run the LLM judge every N ops             |
| `--max-ops`     | 200            | max ops per walk before restart           |
| `--duration`    | 120            | wall-clock budget per worker (seconds)    |
| `--prompt`      | -              | LLM seed prompt (populates the corpus)    |
| `--llm`         | auto           | `on` / `off`; auto = on when a key exists |
| `--corpus`      | fuzz/corpus    | directory for interesting sequences       |
| `--artifacts`   | fuzz/artifacts | bug report output directory               |
| `--seed`        | time           | base seed for the first worker            |
| `--exit-on-bug` | -              | stop a worker after its first bug         |

LLM config via env: `FUZZ_LLM_BASE_URL` (default opencode go), `FUZZ_LLM_API_KEY`
(default: read from the opencode auth.json), `FUZZ_LLM_MODEL`
(default `deepseek-v4-flash`), `FUZZ_LLM_RATE_PER_MINUTE` (default 30).

## Determinism

Workers use a seeded PRNG. Geometry ids are generated deterministically
(`..._fuzzN` counters) instead of random UUIDs so replaying an op sequence
produces the exact same document. This is what makes shrinking, repro and
corpus-sharing trustworthy.

## Notes

- Verified bugs found so far center on DCEL corruption during trim/split and
  undo/redo of trims (`linkNext: ... does not exist`, `splitEdge: ... not
found`) - a known-fragile subsystem. Deduplicated artifacts will concentrate
  on distinct op signatures so investigation isn't swamped with one giant bug.
