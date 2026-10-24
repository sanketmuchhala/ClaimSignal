import { execFileSync } from 'node:child_process';
import { cloudflareAI } from '../benchmarks/cloudflare.ts';
import { createPlan } from './plan.ts';
import type { Selection } from './plan.ts';
import { runPlan } from './runner.ts';
import { tasks } from './tasks.ts';
import { variantOf } from './variants.ts';
import type { VariantId } from './variants.ts';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('ClaimSignal experiments: offline planning by default.\n' +
    'npm run experiment -- --task=<id> [--split=train|validation|test|smoke] [--limit=20]\n' +
    'Add --execute --out=experiment-results/<new-directory> [--model=typesafe/jev] for paid live calls.\n' +
    'Optional --variant=choice-order-reversed-v1|paraphrase-v1|administrative-note-v1 changes one factor.\n' +
    'Tasks:\n' + tasks.map(t => `  ${t.id} (${t.dataset}; ${t.question.type})`).join('\n'));
} else {
  const flags = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(task|split|limit|out|model|variant)=(.+)$/.exec(arg);
    const key = arg === '--execute' ? 'execute' : match?.[1];
    if (!key || flags.has(key)) throw new Error(`Unknown or duplicate argument: ${arg}`);
    flags.set(key, match?.[2] ?? 'true');
  }
  const task = flags.get('task');
  if (!task) throw new Error('--task is required');
  const limit = flags.has('limit') ? Number(flags.get('limit')) : undefined;
  let plan = await createPlan({ task, split: flags.get('split') as Selection['split'], limit });
  if (flags.has('variant')) plan = variantOf(plan, flags.get('variant') as VariantId);
  if (!flags.has('execute')) {
    if (flags.has('out') || flags.has('model')) throw new Error('--out and --model require --execute; redirect plan stdout to save a plan');
    console.log(JSON.stringify(plan, null, 2));
  } else {
    const directory = flags.get('out');
    if (!directory) throw new Error('--execute requires --out=<new-directory>');
    const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
    if (!account || !token) throw new Error('Live execution requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
    const codeRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const workingTreeDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
    const result = await runPlan(plan, cloudflareAI(account, token), {
      directory, model: flags.get('model') ?? 'typesafe/jev', codeRevision, workingTreeDirty, provenance: 'live-provider',
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.failed || result.unattempted) process.exitCode = 1;
  }
}
