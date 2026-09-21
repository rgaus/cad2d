import type { FuzzApp } from './app';
import { snapshotDocument } from './app';
import { type ChatMessage, type LlmConfig, chatComplete, extractJsonObject } from './llm';
import { describeOp } from './ops';
import type { OpRecord } from './types';

export type JudgeVerdict = 'ok' | 'suspect' | 'broken';

export type JudgeResult = {
  verdict: JudgeVerdict;
  reason: string;
  issues: Array<string>;
};

const JUDGE_SYSTEM_PROMPT = `You are a QA engineer inspecting a 2D mechanical CAD document that was
produced by a sequence of editing operations. You are given:
1. The list of operations that were performed, in order.
2. An SVG export of the resulting document.
3. A structured JSON summary of the geometry (polygons, rectangles, ellipses,
   constraints, datums, sheet settings).
4. Optionally a list of "expected properties" the final document should have.

Your job is to decide whether the document looks correct given what was done:
- geometry is where the operations imply, nothing is missing or spurious
- shapes are not unintentionally degenerate (zero-area, NaN, unclosed when they
  should be closed, etc.)
- constraints are present where the operations imply
- shapes referenced by later operations still exist
- the document would "look right" to a human user

DO NOT nitpick imperfect-but-plausible CAD. Only flag things a user would
actually notice as wrong.

Respond with JSON exactly in this shape:
{"verdict":"ok"|"suspect"|"broken","reason":"<why>","issues":["<one per issue>"]}

- "ok" = document is correct / as expected.
- "suspect" = something looks off but you cannot be sure it is wrong.
- "broken" = definite bug: shapes missing/spurious, degenerate geometry,
  constraints wrong, inconsistent document, or the operation log clearly
  implies something that is not present.`;

function buildJudgeUserMessage(
  opDescriptions: Array<string>,
  svg: string | null,
  summary: unknown,
  expected: Array<string> | undefined,
): string {
  const sections: Array<string> = [];
  sections.push(`=== OPERATIONS PERFORMED ===\n${opDescriptions.join('\n')}`);
  if (expected && expected.length > 0) {
    sections.push(`=== EXPECTED PROPERTIES ===\n${expected.map((e) => `- ${e}`).join('\n')}`);
  }
  if (svg) {
    sections.push(`=== SVG EXPORT ===\n${svg}`);
  }
  sections.push(
    `=== GEOMETRY SUMMARY (JSON) ===\n${JSON.stringify(summary, null, 2).slice(0, 60_000)}`,
  );
  return sections.join('\n\n');
}

/**
 * Tier-3 oracle: asks the LLM to judge whether the document produced by `ops`
 * looks correct. Returns null when the LLM is unavailable or the call failed.
 */
export async function judgeDocument(
  config: LlmConfig,
  app: FuzzApp,
  ops: Array<OpRecord>,
  expected: Array<string> | undefined,
): Promise<JudgeResult | null> {
  try {
    const opDescriptions = ops.map((op, index) => `${index + 1}. ${describeOp(op)}`);
    const svg = app.exportSvg();
    const summary = snapshotDocument(app);

    const messages: Array<ChatMessage> = [
      { role: 'system', content: JUDGE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildJudgeUserMessage(opDescriptions, svg, summary, expected),
      },
    ];

    const content = await chatComplete(config, messages, { jsonMode: true });
    const parsed = extractJsonObject<Partial<JudgeResult>>(content);

    const verdict = translateVerdict(parsed.verdict);
    return {
      verdict,
      reason: parsed.reason ?? '',
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
    };
  } catch (e) {
    // If the LLM is flaky, treat as "no verdict" rather than a fuzz bug.
    console.warn(`[fuzz] judge skipped: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function translateVerdict(value: unknown): JudgeVerdict {
  if (value === 'broken' || value === 'suspect' || value === 'ok') {
    return value;
  }
  return 'suspect';
}

const TARGETED_JUDGE_SYSTEM_PROMPT = `You are re-evaluating a suspected bug in a 2D CAD document.
A previous analysis identified this symptom:
<SYMPTOM>
You are given the operations performed, the SVG export and a structured geometry summary.
Decide ONLY whether the stated symptom is still present in the document.
Respond with JSON: {"still_present": true|false, "reason": "..."}`;

/**
 * Targeted oracle used while shrinking semantic bugs: asks the LLM whether the
 * specific symptom still manifests for a candidate (reduced) op sequence.
 */
export async function symptomStillPresent(
  config: LlmConfig,
  app: FuzzApp,
  ops: Array<OpRecord>,
  symptom: string,
): Promise<boolean | null> {
  try {
    const opDescriptions = ops.map((op, index) => `${index + 1}. ${describeOp(op)}`);
    const svg = app.exportSvg();
    const summary = snapshotDocument(app);

    const messages: Array<ChatMessage> = [
      { role: 'system', content: TARGETED_JUDGE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `SYMPTOM:\n${symptom}\n\n${buildJudgeUserMessage(opDescriptions, svg, summary, undefined)}`,
      },
    ];

    const content = await chatComplete(config, messages, { jsonMode: true });
    const parsed = extractJsonObject<{ still_present: unknown }>(content);
    return parsed.still_present === true;
  } catch (e) {
    console.warn(`[fuzz] targeted judge skipped: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
