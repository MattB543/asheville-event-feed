import { env } from '@/lib/config/env';
import { withRetry } from '@/lib/utils/retry';

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';
const README_MAX_CHARS = 500;

const GITHUB_PROFILE_QUERY = `
query GitHubProfile($username: String!) {
  user(login: $username) {
    login
    name
    bio
    company
    location
    websiteUrl
    pronouns
    isHireable
    createdAt
    followers { totalCount }
    following { totalCount }
    socialAccounts(first: 10) { nodes { provider displayName url } }
    organizations(first: 10) { nodes { login name } }
    status { emoji message }
    pinnedItems(first: 6) {
      nodes {
        ... on Repository {
          name description stargazerCount primaryLanguage { name }
          repositoryTopics(first: 5) { nodes { topic { name } } }
          readme_upper: object(expression: "HEAD:README.md") { ... on Blob { text } }
          readme_lower: object(expression: "HEAD:readme.md") { ... on Blob { text } }
        }
      }
    }
    repositories(first: 25, orderBy: {field: PUSHED_AT, direction: DESC}, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
      totalCount
      nodes {
        name description stargazerCount forkCount primaryLanguage { name }
        repositoryTopics(first: 5) { nodes { topic { name } } }
        readme_upper: object(expression: "HEAD:README.md") { ... on Blob { text } }
        readme_lower: object(expression: "HEAD:readme.md") { ... on Blob { text } }
      }
    }
    starredRepositories(first: 25, orderBy: {field: STARRED_AT, direction: DESC}) {
      totalCount
      nodes {
        nameWithOwner description stargazerCount primaryLanguage { name } owner { login }
        repositoryTopics(first: 3) { nodes { topic { name } } }
        readme_upper: object(expression: "HEAD:README.md") { ... on Blob { text } }
        readme_lower: object(expression: "HEAD:readme.md") { ... on Blob { text } }
      }
    }
    repositoriesContributedTo(first: 25, privacy: PUBLIC, includeUserRepositories: false, orderBy: {field: STARGAZERS, direction: DESC}, contributionTypes: [COMMIT, PULL_REQUEST]) {
      totalCount
      nodes {
        nameWithOwner description stargazerCount primaryLanguage { name } owner { login }
        readme_upper: object(expression: "HEAD:README.md") { ... on Blob { text } }
        readme_lower: object(expression: "HEAD:readme.md") { ... on Blob { text } }
      }
    }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      totalRepositoriesWithContributedCommits
      restrictedContributionsCount
      contributionCalendar { totalContributions }
    }
  }
}`;

interface GitHubRepo {
  name: string;
  nameWithOwner?: string;
  description: string | null;
  stargazerCount: number;
  forkCount?: number;
  primaryLanguage: { name: string } | null;
  owner?: { login: string };
  repositoryTopics?: { nodes: Array<{ topic: { name: string } }> };
  readme_upper: { text: string } | null;
  readme_lower: { text: string } | null;
}

interface GitHubSocialAccount {
  provider: string;
  displayName: string;
  url: string;
}

interface GitHubOrganization {
  login: string;
  name: string;
}

interface GitHubContributionsCollection {
  totalCommitContributions: number;
  totalPullRequestContributions: number;
  totalIssueContributions: number;
  totalPullRequestReviewContributions: number;
  totalRepositoriesWithContributedCommits: number;
  restrictedContributionsCount: number;
  contributionCalendar: { totalContributions: number };
}

interface GitHubUser {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  websiteUrl: string | null;
  pronouns: string | null;
  isHireable: boolean;
  createdAt: string;
  followers: { totalCount: number };
  following: { totalCount: number };
  socialAccounts: { nodes: GitHubSocialAccount[] };
  organizations: { nodes: GitHubOrganization[] };
  status: { emoji: string; message: string } | null;
  pinnedItems: { nodes: GitHubRepo[] };
  repositories: { totalCount: number; nodes: GitHubRepo[] };
  starredRepositories: { totalCount: number; nodes: GitHubRepo[] };
  repositoriesContributedTo: { totalCount: number; nodes: GitHubRepo[] };
  contributionsCollection: GitHubContributionsCollection;
}

interface GitHubGraphQLResponse {
  data?: { user?: GitHubUser };
  errors?: { message: string }[];
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '') // headers
    .replace(/!\[.*?\]\(.*?\)/g, '') // images
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // links -> text
    .replace(/```[\s\S]*?```/g, '') // code blocks
    .replace(/`[^`]+`/g, '') // inline code
    .replace(/[*_~]+/g, '') // bold/italic/strike
    .replace(/^\s*[-*+]\s+/gm, '- ') // normalize lists
    .replace(/^\s*\d+\.\s+/gm, '- ') // numbered lists -> bullets
    .replace(/\|.*\|/g, '') // tables
    .replace(/-{3,}/g, '') // horizontal rules
    .replace(/>\s*/gm, '') // blockquotes
    .replace(/\n{3,}/g, '\n\n') // collapse whitespace
    .trim();
}

function getRepoDescription(repo: GitHubRepo): string | null {
  if (repo.description) return repo.description;

  const readmeText = repo.readme_upper?.text || repo.readme_lower?.text;
  if (!readmeText) return null;

  const stripped = stripMarkdown(readmeText);
  const lines = stripped.split('\n').filter((l) => l.trim());
  // Skip the first line if it's just the repo name
  const repoName = repo.nameWithOwner?.split('/')[1] || repo.name;
  const startIdx = lines[0]?.toLowerCase().includes(repoName.toLowerCase()) ? 1 : 0;
  const content = lines.slice(startIdx).join(' ').replace(/\s+/g, ' ').trim();
  if (!content) return null;
  if (content.length <= README_MAX_CHARS) return content;
  return content.slice(0, README_MAX_CHARS).replace(/\s\S*$/, '') + '...';
}

function getTopics(repo: GitHubRepo): string[] {
  return repo.repositoryTopics?.nodes?.map((n) => n.topic.name) ?? [];
}

function formatRepoLine(repo: GitHubRepo, useFullName: boolean): string {
  const name = useFullName ? repo.nameWithOwner || repo.name : repo.name;
  const lang = repo.primaryLanguage?.name;
  const stars = repo.stargazerCount;
  const topics = getTopics(repo);
  const desc = getRepoDescription(repo);

  let line = `- ${name}`;
  const meta = [lang, stars > 0 ? `${stars} stars` : null].filter(Boolean);
  if (meta.length) line += ` [${meta.join(', ')}]`;
  if (topics.length) line += ` (topics: ${topics.join(', ')})`;
  if (desc) line += `\n  ${desc}`;
  return line;
}

function formatGitHubProfile(user: GitHubUser): string {
  const lines: string[] = [];

  lines.push(`## GitHub Profile: ${user.login}`);
  lines.push('');

  // Identity
  const identityParts: string[] = [];
  if (user.name) identityParts.push(user.name);
  if (user.pronouns) identityParts.push(`(${user.pronouns})`);
  if (user.bio) identityParts.push(`— ${user.bio}`);
  if (identityParts.length) lines.push(`**Identity:** ${identityParts.join(' ')}`);

  if (user.location) lines.push(`**Location:** ${user.location}`);
  if (user.company) lines.push(`**Company:** ${user.company}`);
  if (user.websiteUrl) lines.push(`**Website:** ${user.websiteUrl}`);
  if (user.isHireable) lines.push('**Hireable:** Yes');
  if (user.status?.message)
    lines.push(`**Status:** ${user.status.emoji || ''} ${user.status.message}`);

  const socials = user.socialAccounts?.nodes ?? [];
  if (socials.length) {
    lines.push(
      `**Social:** ${socials.map((s) => `${s.provider}: ${s.url || s.displayName}`).join(', ')}`
    );
  }

  const orgs = user.organizations?.nodes ?? [];
  if (orgs.length) {
    lines.push(`**Organizations:** ${orgs.map((o) => o.name || o.login).join(', ')}`);
  }

  lines.push('');

  // Activity
  const c = user.contributionsCollection;
  if (c) {
    const since = new Date(user.createdAt).getFullYear();
    const totalContribs = c.contributionCalendar?.totalContributions ?? 0;
    const totalWithPrivate = totalContribs + (c.restrictedContributionsCount ?? 0);
    const privatePct =
      c.restrictedContributionsCount > 0 && totalWithPrivate > 0
        ? Math.round((c.restrictedContributionsCount / totalWithPrivate) * 100)
        : 0;

    let activityLine = `**Activity (past year):** ${totalContribs} public contributions (${c.totalCommitContributions} commits, ${c.totalPullRequestContributions} PRs, ${c.totalIssueContributions} issues) across ${c.totalRepositoriesWithContributedCommits} repositories.`;
    if (privatePct > 0) activityLine += ` ${privatePct}% of activity is in private repos.`;
    activityLine += ` Member since ${since}.`;
    lines.push(activityLine);
    lines.push('');
  }

  // Pinned repos
  const pinned = user.pinnedItems?.nodes ?? [];
  if (pinned.length) {
    lines.push('**Pinned repositories (self-selected highlights):**');
    for (const repo of pinned) lines.push(formatRepoLine(repo, false));
    lines.push('');
  }

  // Own repos
  const repos = user.repositories?.nodes ?? [];
  if (repos.length) {
    lines.push(`**Recent repositories (${user.repositories.totalCount} total public):**`);
    for (const repo of repos) lines.push(formatRepoLine(repo, false));
    lines.push('');
  }

  // Starred repos
  const starred = user.starredRepositories?.nodes ?? [];
  if (starred.length) {
    lines.push(
      `**Recently starred (${user.starredRepositories.totalCount} total, current interests):**`
    );
    for (const repo of starred) lines.push(formatRepoLine(repo, true));
    lines.push('');
  }

  // Contributed to
  const contributed = user.repositoriesContributedTo?.nodes ?? [];
  if (contributed.length) {
    lines.push('**Open source contributions (repos by others):**');
    for (const repo of contributed) lines.push(formatRepoLine(repo, true));
    lines.push('');
  }

  return lines.join('\n');
}

export async function fetchGitHubProfile(username: string): Promise<{
  ok: boolean;
  text?: string;
  error?: string;
}> {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    return { ok: false, error: 'GITHUB_TOKEN is not configured' };
  }

  const response = await withRetry(
    async () => {
      const res = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: GITHUB_PROFILE_QUERY,
          variables: { username },
        }),
      });

      if (res.status === 429 || res.status >= 500) {
        throw new Error(`GitHub API retryable HTTP ${res.status}`);
      }

      return res;
    },
    { maxRetries: 2, baseDelay: 2000, maxDelay: 10000 }
  );

  if (!response.ok) {
    return { ok: false, error: `GitHub API HTTP ${response.status}` };
  }

  const json = (await response.json()) as GitHubGraphQLResponse;

  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join('; ');
    return { ok: false, error: `GitHub GraphQL error: ${msg}` };
  }

  const user = json.data?.user;
  if (!user) {
    return { ok: false, error: `GitHub user "${username}" not found` };
  }

  const text = formatGitHubProfile(user);
  return { ok: true, text };
}
