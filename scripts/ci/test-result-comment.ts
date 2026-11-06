/**
 * Turns Vitest's JSON report into the test results comment CI posts on a pull request.
 * Usage: npx tsx scripts/ci/test-result-comment.ts <vitest.json> <run url>
 */
import { existsSync, readFileSync } from 'node:fs';

interface Report {
  numTotalTests: number;
  testResults: {
    name: string;
    message: string;
    assertionResults: { fullName: string; status: string; failureMessages: string[] }[];
  }[];
}

const [reportPath, runUrl] = process.argv.slice(2);
const lines = ['<!-- test-suite-result -->'];

if (!existsSync(reportPath)) {
  // The suite never got as far as reporting: a setup failure such as the test database
  lines.push(`**Tests didn't run.** See the [log](${runUrl}).`);
} else {
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
  const cwd = `${process.cwd()}/`;
  const failures = report.testResults.flatMap((file) => {
    const where = file.name.replace(cwd, '');
    const tests = file.assertionResults
      .filter((test) => test.status === 'failed')
      .map((test) => ({ title: `${where}: ${test.fullName}`, detail: test.failureMessages[0] }));
    // A file that fails to load reports its error with no test results
    if (tests.length === 0 && file.message) return [{ title: where, detail: file.message }];
    return tests;
  });

  if (failures.length === 0) {
    lines.push(`**Tests passed:** all ${report.numTotalTests}. [Log](${runUrl})`);
  } else {
    lines.push(
      `**Tests failed:** ${failures.length} of ${report.numTotalTests}. [Log](${runUrl})`,
      ''
    );
    for (const failure of failures) {
      const detail = (failure.detail ?? '')
        .replace(/\u001b\[[0-9;]*m/g, '')
        .split('\n')
        .slice(0, 12)
        .join('\n');
      lines.push(
        `<details><summary>${failure.title}</summary>`,
        '',
        '```',
        detail,
        '```',
        '</details>'
      );
    }
  }
}

console.log(lines.join('\n'));
