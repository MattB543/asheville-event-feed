import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env file with override:true to always prefer local .env over OS env vars
// This ensures consistent behavior between development and scripts
dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
  override: true,
});

// Export typed environment variables
export const env = {
  get DATABASE_URL() { return process.env.DATABASE_URL!; },
  get GEMINI_API_KEY() { return process.env.GEMINI_API_KEY; },
  get GEMINI_IMAGE_MODEL() { return process.env.GEMINI_IMAGE_MODEL; },
  get CRON_SECRET() { return process.env.CRON_SECRET; },
  get OPENROUTER_API_KEY() { return process.env.OPENROUTER_API_KEY; },
  get SLACK_WEBHOOK() { return process.env.SLACK_WEBHOOK; },
  // Supabase Auth
  get NEXT_PUBLIC_SUPABASE_URL() { return process.env.NEXT_PUBLIC_SUPABASE_URL; },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY() { return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; },
  // Postmark Email
  get POSTMARK_API_KEY() { return process.env.POSTMARK_API_KEY; },
  get POSTMARK_FROM_EMAIL() { return process.env.POSTMARK_FROM_EMAIL; },
  get NEXT_PUBLIC_APP_URL() { return process.env.NEXT_PUBLIC_APP_URL || 'https://avlgo.com'; },
} as const;

// Helper to check if AI features are enabled
export function isAIEnabled(): boolean {
  return !!env.GEMINI_API_KEY;
}

// Helper to check if OpenRouter chat is enabled
export function isChatEnabled(): boolean {
  return !!env.OPENROUTER_API_KEY;
}

// Helper to check if Slack notifications are enabled
export function isSlackEnabled(): boolean {
  return !!env.SLACK_WEBHOOK;
}

// Helper to check if Postmark email is enabled
export function isPostmarkEnabled(): boolean {
  return !!(env.POSTMARK_API_KEY && env.POSTMARK_FROM_EMAIL);
}

// Helper to check if Supabase Auth is configured
export function isAuthEnabled(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// Facebook configuration
export const FB_CONFIG = {
  enabled: process.env.FB_ENABLED === 'true',
  cookies: {
    c_user: process.env.FB_C_USER,
    xs: process.env.FB_XS,
    fr: process.env.FB_FR,
    datr: process.env.FB_DATR,
    sb: process.env.FB_SB,
  },
  tokens: {
    fb_dtsg: process.env.FB_DTSG,
    lsd: process.env.FB_LSD,
    jazoest: process.env.FB_JAZOEST,
    user: process.env.FB_USER,
    rev: process.env.FB_REV,
  },
  locationId: process.env.FB_LOCATION_ID || '104063499628686',
} as const;

// Helper to check if Facebook scraping is enabled and configured
// Note: Facebook scraping is disabled on Vercel due to browser/Playwright requirements
export function isFacebookEnabled(): boolean {
  // Skip on Vercel - Facebook scraping requires browser automation that doesn't work in serverless
  if (process.env.VERCEL) {
    return false;
  }

  return (
    FB_CONFIG.enabled &&
    !!FB_CONFIG.cookies.c_user &&
    !!FB_CONFIG.cookies.xs &&
    !!FB_CONFIG.tokens.fb_dtsg &&
    !!FB_CONFIG.tokens.lsd
  );
}
