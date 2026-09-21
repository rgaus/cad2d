import { FuzzApp } from './app';
import { ensureDir } from './corpus';
import { runInvariants } from './invariants';
import { loadLlmConfig } from './llm';
import { PRNG } from './prng';
import type { FuzzWorkerConfig } from './types';
import { type LlmConfigOrNull, chooseInitialOps, handleBug, primeCorpus, runWalk } from './worker';

const MAX_LOG_LENGTH = 2000;

// App code sometimes logs huge debug dumps (e.g. the DCEL 'START [...' trace)
// that can flood stdout and even OOM the worker. Truncate long log lines and
// only allow one big log per tick to keep the worker alive.
const originalLog = console.log.bind(console);
let lastBigLogAt = 0;
console.log = (...args: Array<unknown>) => {
  const joined = args
    .map((a) => {
      if (typeof a === 'string') {
        return a;
      }
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  if (joined.length > MAX_LOG_LENGTH) {
    const now = Date.now();
    if (now - lastBigLogAt < 20) {
      return; // drop the flood
    }
    lastBigLogAt = now;
    originalLog(
      joined.slice(0, MAX_LOG_LENGTH) + `... [truncated ${joined.length - MAX_LOG_LENGTH} chars]`,
    );
    return;
  }
  originalLog(joined);
};

/**
 * Worker process entrypoint. The CLI spawns one process per "thread"; each gets
 * the same config via FUZZ_WORKER_CONFIG but a distinct seed.
 */
async function main(): Promise<void> {
  const raw = process.env.FUZZ_WORKER_CONFIG;
  if (!raw) {
    console.error('worker: FUZZ_WORKER_CONFIG env var not set');
    process.exit(2);
  }
  const config = JSON.parse(raw) as FuzzWorkerConfig;

  const llmConfig: LlmConfigOrNull = config.llmEnabled ? loadLlmConfig() : null;
  if (!llmConfig) {
    console.warn('[worker] LLM disabled for this worker (no API key found; set FUZZ_LLM_API_KEY)');
  }

  ensureDir(config.corpusDir);
  ensureDir(config.artifactsDir);

  await primeCorpus(config, config.prompt, llmConfig);

  const startedAt = Date.now();
  let bugCount = 0;
  let walkSeed = config.seed >>> 0;

  while (true) {
    if (config.durationSeconds > 0 && Date.now() - startedAt > config.durationSeconds * 1000) {
      break;
    }

    const rng = new PRNG(walkSeed);
    const startsWith = await chooseInitialOps(config, rng);
    const outcome = await runWalk(config, walkSeed, rng, startsWith, llmConfig);

    if (outcome.foundBug) {
      const caseId = await handleBug(config, outcome, llmConfig);
      bugCount += 1;
      if (config.exitAfterBug) {
        console.log(`[worker ${config.seed}] found bug ${caseId} and exiting`);
        process.exit(0);
      }
    }

    walkSeed = (walkSeed + 977) >>> 0;
  }

  console.log(`[worker ${config.seed}] finished: ${bugCount} bugs found`);
  process.exit(0);
}

void main();
export { runInvariants, FuzzApp };
