import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';

// The chat checks are standalone scripts (they also have a paid --live mode), so the suite runs
// their offline mode as is rather than keeping a second copy of them here
const runOffline = (script: string) =>
  execFileSync('npx', ['tsx', script], { stdio: 'pipe', timeout: 60_000 });

describe('AI chat offline checks', () => {
  it('events chat', () => {
    runOffline('scripts/test-chat.ts');
  });

  it('camps chat', () => {
    runOffline('scripts/test-camps-chat.ts');
  });
});
