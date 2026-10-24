import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { analyze } from './analyze.ts';
import { loadRun } from './io.ts';
import { normalized } from './metrics.ts';
import { variantOf } from './variants.ts';
import type { Answer, Plan } from './types.ts';

function vector(answer: Answer) {
  return answer.type === 'noul' ? { no: 1 - answer.noul, yes: answer.noul } : normalized(answer.probabilities);
}
function decision(answer: Answer, plan: Plan): string | number {
  if (answer.type === 'score') return answer.score;
  if (answer.type === 'noul') return Number(answer.noul >= 0.5);
  return plan.task.positiveOption ? Number(normalized(answer.probabilities)[plan.task.positiveOption] >= 0.5) : answer.choice;
}
export function robustness(base: Awaited<ReturnType<typeof loadRun>>, variant: Awaited<ReturnType<typeof loadRun>>) {
  const a = analyze(base.plan, base.rows, base.run), b = analyze(variant.plan, variant.rows, variant.run);
  if (!variant.plan.variant || variantOf(base.plan, variant.plan.variant.id).id !== variant.plan.id) throw new Error('Variant is not the declared transformation of this base plan');
  if (base.run.provenance !== variant.run.provenance || base.run.adapter !== variant.run.adapter || base.run.requestedModel !== variant.run.requestedModel || a.resolvedModel !== b.resolvedModel || a.resolvedModel?.startsWith('unreported:')) throw new Error('Robustness comparison requires the same provider and reported model version');
  const right = new Map(variant.rows.filter(r => r.status === 'ok').map(r => [r.exampleId, r]));
  const pairs = base.rows.filter(r => r.status === 'ok' && right.has(r.exampleId)).map(row => {
    const other = right.get(row.exampleId)!;
    const p = vector(row.answer!), q = vector(other.answer!);
    const totalVariation = Object.keys(p).reduce((sum, k) => sum + Math.abs(p[k] - q[k]), 0) / 2;
    const original = decision(row.answer!, base.plan), changed = decision(other.answer!, variant.plan);
    return { exampleId: row.exampleId, original, changed, totalVariation,
      decisionFlipped: row.answer!.type === 'score' ? null : original !== changed,
      absoluteScoreChange: row.answer!.type === 'score' ? Math.abs(Number(original) - Number(changed)) : null };
  });
  const score = base.plan.task.question.type === 'score';
  return {
    kind: 'PAIRED CLAIMS ROBUSTNESS', provenance: base.run.provenance, basePlanId: base.plan.id, variantPlanId: variant.plan.id, variant: variant.plan.variant,
    planned: base.plan.examples.length, paired: pairs.length, unpaired: base.plan.examples.length - pairs.length,
    meanTotalVariation: pairs.length ? pairs.reduce((s, p) => s + p.totalVariation, 0) / pairs.length : null,
    flipRate: !score && pairs.length ? pairs.filter(p => p.decisionFlipped).length / pairs.length : null,
    meanAbsoluteScoreChange: score && pairs.length ? pairs.reduce((s, p) => s + p.absoluteScoreChange!, 0) / pairs.length : null,
    limitations: ['Pairs are transformations of the same claims, not additional independent samples.', 'One call per form; stochastic variation is not separated from prompt sensitivity.', 'A changed prediction is not necessarily a worse prediction. Review both labeled reports.', 'Paraphrase equivalence is a design assumption, not a mathematical guarantee.'],
    base: a, transformed: b, pairs,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = /^--(base|variant|out)=(.+)$/.exec(arg);
    if (!m || flags.has(m[1])) throw new Error('Use --base=<run> --variant=<run> [--out=<new.json>]');
    flags.set(m[1], m[2]);
  }
  if (!flags.has('base') || !flags.has('variant')) throw new Error('--base and --variant are required');
  const report = robustness(await loadRun(flags.get('base')!), await loadRun(flags.get('variant')!));
  const output = JSON.stringify(report, null, 2) + '\n';
  if (flags.has('out')) await writeFile(flags.get('out')!, output, { flag: 'wx' }); else process.stdout.write(output);
}
