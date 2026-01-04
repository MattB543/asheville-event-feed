#!/usr/bin/env npx tsx
/**
 * Vercel Logs Explorer
 *
 * A utility script to explore Vercel production logs from the CLI.
 *
 * Usage:
 *   npx tsx scripts/vercel-logs.ts [command] [options]
 *
 * Commands:
 *   live          - Stream live runtime logs from the latest production deployment
 *   build         - Show build logs from the latest production deployment
 *   list          - List recent deployments
 *   inspect       - Show deployment details
 *   cron          - Stream logs filtered for cron job activity
 *   errors        - Stream logs filtered for errors
 *   scrape        - Stream logs filtered for scraper activity
 *   ai            - Stream logs filtered for AI processing
 *
 * Options:
 *   --json        - Output in JSON format (for live/cron/errors commands)
 *   --deployment  - Use a specific deployment URL instead of latest
 *   --limit       - Number of deployments to list (default: 10)
 *
 * Prerequisites:
 *   1. Install Vercel CLI: npm i -g vercel
 *   2. Login to Vercel: vercel login
 *   3. Link your project: vercel link (run in project root)
 *
 * Note: Runtime logs are only available for ~1 hour in Vercel.
 * The `vercel logs` command streams live logs for up to 5 minutes.
 * For historical logs, use the Vercel dashboard: https://vercel.com/dashboard
 */

import { execSync, spawn } from 'child_process';

const HELP_TEXT = `
Vercel Logs Explorer

Usage:
  npx tsx scripts/vercel-logs.ts [command] [options]

Commands:
  live          Stream live runtime logs (default)
  build         Show build logs from latest deployment
  list          List recent deployments
  inspect       Show deployment details
  cron          Stream logs filtered for cron activity
  errors        Stream logs filtered for errors
  scrape        Stream logs filtered for scraper activity
  ai            Stream logs filtered for AI processing
  help          Show this help message

Options:
  --json, -j         Output in JSON format (for log streaming)
  --deployment, -d   Use specific deployment URL instead of latest

Examples:
  npx tsx scripts/vercel-logs.ts live
  npx tsx scripts/vercel-logs.ts build
  npx tsx scripts/vercel-logs.ts list
  npx tsx scripts/vercel-logs.ts cron
  npx tsx scripts/vercel-logs.ts errors
  npx tsx scripts/vercel-logs.ts live --deployment https://your-deployment.vercel.app

Note: Runtime logs are only stored for ~1 hour. For historical logs,
      use the Vercel dashboard: https://vercel.com/dashboard
`;

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0] || 'live';

function getArg(names: string[]): string | undefined {
  for (const name of names) {
    const idx = args.indexOf(name);
    if (idx !== -1 && args[idx + 1]) {
      return args[idx + 1];
    }
  }
  return undefined;
}

function hasFlag(names: string[]): boolean {
  return names.some((name) => args.includes(name));
}

const useJson = hasFlag(['--json', '-j']);
const deploymentUrl = getArg(['--deployment', '-d']);

// Check if Vercel CLI is installed
function checkVercelCLI(): boolean {
  try {
    execSync('vercel --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Get the latest production deployment URL
function getLatestDeployment(): string | null {
  try {
    // vercel list outputs URLs first, then a table
    // We grab the first URL which is the latest deployment
    const result = execSync('vercel list', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Find lines that look like deployment URLs
    const lines = result.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('https://') && trimmed.includes('.vercel.app')) {
        return trimmed;
      }
    }
  } catch {
    console.error("Failed to get latest deployment. Make sure you've run 'vercel link'.");
  }
  return null;
}

// Stream live logs with optional filtering
function streamLogs(deployment: string, filter?: string) {
  const args = ['logs', deployment];
  if (useJson) args.push('--json');

  console.log(`\n[LIVE] Streaming live logs from: ${deployment}`);
  if (filter) {
    console.log(`   Filtering for: ${filter}`);
  }
  console.log('   Press Ctrl+C to stop\n');
  console.log('─'.repeat(60));

  const proc = spawn('vercel', args, {
    stdio: filter ? ['pipe', 'pipe', 'inherit'] : 'inherit',
    shell: true,
  });

  if (filter && proc.stdout) {
    proc.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.toLowerCase().includes(filter.toLowerCase())) {
          console.log(line);
        }
      }
    });
  }

  proc.on('error', (err) => {
    console.error('Error streaming logs:', err.message);
  });

  proc.on('close', () => {
    console.log('\n' + '─'.repeat(60));
    console.log('Log stream ended.');
  });
}

// Show build logs
function showBuildLogs(deployment: string) {
  console.log(`\n[BUILD] Build logs for: ${deployment}\n`);
  console.log('─'.repeat(60));

  try {
    execSync(`vercel inspect ${deployment} --logs`, {
      stdio: 'inherit',
    });
  } catch {
    console.error('Failed to fetch build logs.');
  }
}

// List recent deployments
function listDeployments() {
  console.log(`\n[DEPLOYMENTS] Recent deployments:\n`);

  try {
    // Just pass through to vercel list which has nice formatting
    execSync('vercel list', {
      stdio: 'inherit',
    });
    console.log(
      `\nUse 'npm run logs:live -- --deployment <url>' to view logs for a specific deployment`
    );
  } catch {
    console.error("Failed to list deployments. Make sure you've run 'vercel link'.");
  }
}

// Show deployment details
function inspectDeployment(deployment: string) {
  console.log(`\n[INFO] Deployment details: ${deployment}\n`);

  try {
    execSync(`vercel inspect ${deployment}`, {
      stdio: 'inherit',
    });
  } catch {
    console.error('Failed to inspect deployment.');
  }
}

// Main execution
async function main() {
  if (command === 'help' || hasFlag(['--help', '-h'])) {
    console.log(HELP_TEXT);
    return;
  }

  if (!checkVercelCLI()) {
    console.error(`
[FAIL] Vercel CLI is not installed.

To install:
  npm install -g vercel

Then login and link your project:
  vercel login
  vercel link
    `);
    process.exit(1);
  }

  // Get deployment URL
  let deployment = deploymentUrl;
  if (!deployment && command !== 'list' && command !== 'help') {
    console.log('[INFO] Finding latest production deployment...');
    deployment = getLatestDeployment() ?? undefined;
    if (!deployment) {
      console.error(`
[FAIL] Could not find deployment. Make sure you:
1. Are logged in: vercel login
2. Have linked your project: vercel link
      `);
      process.exit(1);
    }
  }

  switch (command) {
    case 'live':
      streamLogs(deployment!);
      break;

    case 'build':
      showBuildLogs(deployment!);
      break;

    case 'list':
      listDeployments();
      break;

    case 'inspect':
      inspectDeployment(deployment!);
      break;

    case 'cron':
      streamLogs(deployment!, '/api/cron');
      break;

    case 'errors':
      streamLogs(deployment!, 'error');
      break;

    case 'scrape':
      streamLogs(deployment!, 'scrape');
      break;

    case 'ai':
      streamLogs(deployment!, '/api/cron/ai');
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP_TEXT);
      process.exit(1);
  }
}

main().catch(console.error);
