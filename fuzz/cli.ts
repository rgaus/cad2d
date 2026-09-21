import { type ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';
import { readCorpus } from './corpus';
import { ensureDir } from './corpus';
import { loadLlmConfig } from './llm';
import { formatReproResult, reproduceCase } from './repro';
import type { FuzzWorkerConfig } from './types';
import { primeCorpus } from './worker';

const HELP = `Cad2d fuzz harness
====================

USAGE
  npx tsx fuzz/cli.ts run [options]          Start the fuzzer (n parallel workers)
  npx tsx fuzz/cli.ts gen --prompt "..."     Generate LLM seed sequences into the corpus
  npx tsx fuzz/cli.ts repro <caseDir>        Replay a bug artifact and check if it reproduces
  npx tsx fuzz/cli.ts corpus                 List the current corpus entries

OPTIONS (run)
  --threads <n>            Number of parallel worker processes (default 1)
  --check-every <n>        Ask the LLM judge every n ops (default 20)
  --max-ops <n>            Max ops per walk before restart (default 200)
  --duration <s>           Wall-clock budget in seconds per worker (default 120)
  --prompt "<text>"        Natural-language prompt used to seed the corpus
  --llm on|off             Force the LLM judge on/off (default: auto)
  --corpus <dir>           Corpus directory (default fuzz/corpus)
  --artifacts <dir>        Artifact directory (default fuzz/artifacts)
  --seed <n>               Base seed for the first worker (default: time based)
  --exit-on-bug            Exit each worker after its first bug (for small runs)

ENVIRONMENT
  FUZZ_LLM_BASE_URL        OpenAI-compatible base URL (default opencode go)
  FUZZ_LLM_API_KEY         API key (default: read from opencode auth.json)
  FUZZ_LLM_MODEL           Model id (default deepseek-v4-flash)
`;

type Args = Record<string, string>;

function parseArgs(argv: Array<string>): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[name] = next;
        i += 1;
      } else {
        out[name] = 'true';
      }
    }
  }
  return out;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function makeConfig(args: Args, seed: number): FuzzWorkerConfig {
  const llmFlag = (args['llm'] ?? 'auto').toLowerCase();
  const llmAvailable = loadLlmConfig() !== null;
  const llmEnabled = llmFlag === 'on' || (llmFlag !== 'off' && llmAvailable);

  if (llmFlag === 'auto' && !llmAvailable) {
    console.warn(
      '[fuzz] no LLM API key found (FUZZ_LLM_API_KEY or opencode auth.json). The LLM judge and seed generation are disabled.',
    );
  }

  return {
    seed,
    threads: num(args['threads'], 1),
    checkEvery: num(args['check-every'], 20),
    maxOpsPerRun: num(args['max-ops'], 200),
    maxBugsBeforeRestart: 0,
    corpusDir: args['corpus'] ?? 'fuzz/corpus',
    artifactsDir: args['artifacts'] ?? 'fuzz/artifacts',
    llmEnabled,
    llmBaseUrl: process.env.FUZZ_LLM_BASE_URL ?? null,
    llmApiKey: process.env.FUZZ_LLM_API_KEY ?? null,
    llmModel: process.env.FUZZ_LLM_MODEL ?? 'deepseek-v4-flash',
    llmRatePerMinute: num(process.env.FUZZ_LLM_RATE_PER_MINUTE, 30),
    prompt: args['prompt'] ?? null,
    durationSeconds: num(args['duration'], 120),
    exitAfterBug: args['exit-on-bug'] === 'true',
  };
}

async function runFuzz(args: Args): Promise<number> {
  const threads = Math.max(1, num(args['threads'], 1));
  const baseSeed = num(args['seed'], (Date.now() % 0xffffffff) >>> 0);
  const config = makeConfig(args, baseSeed);

  ensureDir(config.corpusDir);
  ensureDir(config.artifactsDir);

  // Prime the corpus from the prompt if requested (before spawning workers).
  if (config.prompt && config.llmEnabled) {
    await primeCorpus(config, config.prompt, loadLlmConfig());
  }

  const workerScript = path.join(__dirname, 'worker-entry.ts');
  const tsxBin = path.resolve(__dirname, '..', 'node_modules', '.bin', 'tsx');

  console.log(
    `[fuzz] starting ${threads} worker(s), checkEvery=${config.checkEvery}, llm=${config.llmEnabled ? 'on' : 'off'}`,
  );

  const children: Array<ChildProcess> = [];
  const childEnv = {
    ...process.env,
    // Cap each worker's heap so the DCEL OOM bug fails the worker fast instead
    // of thrashing for GBs; the slot is respawned below.
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=1024`.trimStart(),
  };

  const spawnChild = (seed: number): ChildProcess => {
    const child = spawn(tsxBin, [workerScript], {
      env: { ...childEnv, FUZZ_WORKER_CONFIG: JSON.stringify({ ...config, seed }) },
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
    });
    children.push(child);
    return child;
  };

  const onSigint = () => {
    for (const child of children) {
      child.kill('SIGINT');
    }
  };
  process.on('SIGINT', onSigint);

  // Each thread is a "slot" that keeps running until the duration budget is up.
  // Workers self-stop at the budget, but a worker can also die early (e.g. an
  // OOM from the DCEL bug); in that case we respawn it with the same seed.
  const deadline = Date.now() + config.durationSeconds * 1000;

  const runSlot = async (seed: number): Promise<{ code: number | null }> => {
    let code: number | null = null;
    while (Date.now() < deadline) {
      code = await new Promise<number | null>((resolve) => {
        const child = spawnChild(seed);
        child.on('close', (closeCode) => resolve(closeCode));
        child.on('error', (err) => {
          console.error('[fuzz] worker failed to start:', err);
          resolve(1);
        });
      });
      if (Date.now() >= deadline) {
        break;
      }
      console.log(`[fuzz] worker seed=${seed} exited early (code=${code}); respawning`);
    }
    return { code };
  };

  const results = await Promise.all(
    Array.from({ length: threads }, (_, i) => runSlot((baseSeed + i * 4099) >>> 0)),
  );
  process.off('SIGINT', onSigint);

  const failed = results.filter((r) => r.code !== 0).length;
  console.log(`[fuzz] all workers exited (${failed} failed)`);
  return failed > 0 ? 1 : 0;
}

async function runGen(args: Args): Promise<number> {
  const prompt = args['prompt'];
  if (!prompt) {
    console.error('gen requires --prompt "<text>"');
    return 2;
  }
  const llm = loadLlmConfig();
  if (!llm) {
    console.error('No LLM API key available to generate seeds.');
    return 2;
  }
  const config = makeConfig(args, (Date.now() % 0xffffffff) >>> 0);
  const added = await primeCorpus(config, prompt, llm);
  console.log(added ? 'Seed corpus populated (see output above).' : 'No seeds generated.');
  return 0;
}

function listCorpus(args: Args): number {
  const corpusDir = args['corpus'] ?? 'fuzz/corpus';
  const entries = readCorpus(corpusDir);
  if (entries.length === 0) {
    console.log('Corpus is empty.');
    return 0;
  }
  console.log(`Corpus (${entries.length} entries):`);
  for (const entry of entries) {
    console.log(`- ${entry.id}: ${entry.interest} (${entry.ops.length} ops)`);
  }
  return 0;
}

async function main(): Promise<void> {
  const [commandName, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (commandName) {
    case 'run':
      process.exit(await runFuzz(args));
      break;
    case 'gen':
      process.exit(await runGen(args));
      break;
    case 'repro': {
      const caseDir = rest[0];
      if (!caseDir) {
        console.error('repro requires a case directory, e.g. fuzz/artifacts/bug-123');
        process.exit(2);
      }
      try {
        const result = await reproduceCase(caseDir);
        process.exit(formatReproResult(result));
      } catch (e) {
        console.error(`repro failed: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(2);
      }
      break;
    }
    case 'corpus':
      process.exit(listCorpus(args));
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      process.exit(0);
      break;
    default:
      console.log(HELP);
      process.exit(commandName ? 2 : 0);
      break;
  }
}

void main();
