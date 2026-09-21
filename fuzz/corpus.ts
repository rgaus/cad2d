import * as fs from 'node:fs';
import * as path from 'node:path';
import { PRNG } from './prng';
import type { CorpusEntry } from './types';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function listJsonFiles(dir: string): Array<string> {
  ensureDir(dir);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dir, name));
}

/** Loads every corpus entry from the given directory. */
export function readCorpus(corpusDir: string): Array<CorpusEntry> {
  const entries: Array<CorpusEntry> = [];
  for (const file of listJsonFiles(corpusDir)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CorpusEntry;
      if (parsed && Array.isArray(parsed.ops)) {
        entries.push(parsed);
      }
    } catch {
      // Skip unparseable corpus files.
    }
  }
  return entries;
}

/** Picks a corpus entry uniformly at random. */
export function sampleCorpus(corpusDir: string, rng: PRNG): CorpusEntry | null {
  const entries = readCorpus(corpusDir);
  if (entries.length === 0) {
    return null;
  }
  return rng.pick(entries);
}

/** Appends an entry to the corpus, writing it to its own JSON file. */
export function appendCorpus(corpusDir: string, entry: CorpusEntry): void {
  ensureDir(corpusDir);
  const existing = readCorpus(corpusDir);
  const key = JSON.stringify(entry.ops);
  for (const prior of existing) {
    if (JSON.stringify(prior.ops) === key) {
      return; // already known
    }
  }
  const file = path.join(corpusDir, `${entry.id}.json`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2));
}

/** Writes a full bug artifact set out to disk. */
export function writeArtifacts(
  artifactsDir: string,
  caseId: string,
  files: Record<string, string>,
): string {
  const dir = path.join(artifactsDir, caseId);
  ensureDir(dir);
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

/** Reads an ops.json file produced by writeArtifacts. */
export function readOpsFile(file: string): Array<any> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}
