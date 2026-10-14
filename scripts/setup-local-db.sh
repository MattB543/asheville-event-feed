#!/usr/bin/env bash
# Sets up a local Postgres database for development, then asks how to fill it.
# Safe to re-run: every step skips what's already done.
set -euo pipefail

DB_NAME="${1:-avlgo}"
LOCAL_URL="postgresql://localhost:5432/${DB_NAME}"
cd "$(dirname "$0")/.."

ask() {
  local reply
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy] ]]
}

echo "1. Postgres"
if ! pg_isready -q; then
  echo "   Postgres isn't running. Start it (e.g. brew services start postgresql@17) and re-run."
  exit 1
fi
echo "   running"

echo "2. pgvector"
has_vector() {
  [[ "$(psql -At -d postgres -c "select 1 from pg_available_extensions where name = 'vector'")" == "1" ]]
}
if ! has_vector; then
  if ask "   pgvector isn't installed. Install it with Homebrew?"; then
    brew install pgvector
  fi
  if ! has_vector; then
    echo "   Postgres still can't find pgvector. It needs a build matching your Postgres version."
    exit 1
  fi
fi
echo "   available"

echo "3. Database '${DB_NAME}'"
if psql -At -d postgres -c "select 1 from pg_database where datname = '${DB_NAME}'" | grep -q 1; then
  echo "   already exists"
else
  # template0, not the default template, so extensions added to template1 (e.g. PostGIS)
  # don't bring tables that drizzle-kit push would stop to ask about
  createdb -T template0 "$DB_NAME"
  echo "   created"
fi
psql -q -d "$DB_NAME" -c "create extension if not exists vector"

echo "4. .env"
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "   created from .env.example"
fi
current_url="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- || true)"
if [[ "$current_url" == "$LOCAL_URL" ]]; then
  echo "   DATABASE_URL already points here"
elif [[ -z "$current_url" ]] || [[ "$current_url" == *"your-password"* ]] ||
  ask "   .env's DATABASE_URL points somewhere else. Replace it with ${LOCAL_URL}?"; then
  grep -vE '^DATABASE_URL=' .env > .env.tmp || true
  { echo "DATABASE_URL=${LOCAL_URL}"; cat .env.tmp; } > .env
  rm .env.tmp
  echo "   DATABASE_URL set to ${LOCAL_URL}"
else
  echo "   left as is; tables and events below go to that database instead"
fi

echo "5. Tables"
npx drizzle-kit push

echo
echo "6. Events. How should the database be filled?"
echo "   1) Copy upcoming events from avlgo.com (about 5,000, with scores and tags) [default]"
echo "   2) Scrape Eventbrite (a few minutes, no scores or tags)"
echo "   3) Leave it empty"
read -r -p "   Choose 1-3 [1]: " choice
case "${choice:-1}" in
  1) npx tsx scripts/maintenance/seed-from-live.ts ;;
  2) npm run backfill ;;
  *) echo "   skipped" ;;
esac

echo
echo "Done. Start the site with: npm run dev"
