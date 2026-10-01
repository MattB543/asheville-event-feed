/**
 * The news pipeline's model. It runs on its own Azure deployment so events can
 * stay on theirs (AZURE_OPENAI_DEPLOYMENT). gpt-6.1-sol only accepts the
 * default temperature and reasoning efforts low | medium | high | xhigh.
 */
export function newsDeployment(): string {
  return process.env.AZURE_OPENAI_NEWS_DEPLOYMENT || 'gpt-6.1-sol';
}
