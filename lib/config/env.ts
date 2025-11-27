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
} as const;

// Helper to check if AI features are enabled
export function isAIEnabled(): boolean {
  return !!env.GEMINI_API_KEY;
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
