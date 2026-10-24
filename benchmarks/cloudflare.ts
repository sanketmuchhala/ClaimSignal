import type { AI } from '../src/domain.ts';
import { record } from '../src/domain.ts';

// Workers AI over the REST API. HTTP 429 comes from the account rate limiter before any model runs;
// `onRateLimited` hears about each one, with whether the daily free allocation is spent.
export function cloudflareAI(account: string, token: string, onRateLimited: (dailyAllocationSpent: boolean) => void = () => {}): AI {
  return {
    async run(model, input) {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input }), signal: AbortSignal.timeout(8000),
      });
      if (response.status === 429) onRateLimited(/daily free allocation/i.test(await response.text()));
      if (!response.ok) throw new Error(`Cloudflare HTTP ${response.status}`);
      const envelope = record(await response.json());
      if (envelope.success !== true) throw new Error('Cloudflare inference failed');
      return envelope.result;
    },
  };
}
