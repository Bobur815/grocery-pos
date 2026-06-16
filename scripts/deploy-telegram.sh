#!/bin/bash

# Deploy standalone Telegram bot to UZ VPS
# Usage: ./scripts/deploy-telegram.sh [user@host] [path]

set -e

VPS_USER="${TELEGRAM_VPS_USER:-bobur}"
VPS_HOST="${TELEGRAM_VPS_HOST:-45.138.158.220}"
VPS_PORT="${TELEGRAM_VPS_PORT:-2222}"
VPS_PATH="${TELEGRAM_VPS_PATH:-/opt/grocery-telegram-bot}"
VPS_KEY="${TELEGRAM_VPS_KEY:-$HOME/.ssh/uz_vps}"
APP_NAME="grocery-telegram-bot"

KEY_OPT=""
if [ -f "$VPS_KEY" ]; then
  KEY_OPT="-i $VPS_KEY -o IdentitiesOnly=yes"
else
  KEY_OPT="-o PubkeyAuthentication=no"
fi

SSH="ssh $KEY_OPT -p $VPS_PORT -o StrictHostKeyChecking=accept-new"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${GREEN}[Deploy]${NC} $1"; }
warn()  { echo -e "${YELLOW}[Warning]${NC} $1"; }
error() { echo -e "${RED}[Error]${NC} $1"; exit 1; }

command -v ssh  >/dev/null 2>&1 || error "ssh is required"
command -v scp  >/dev/null 2>&1 || error "scp is required"
command -v npm  >/dev/null 2>&1 || error "npm is required"
command -v npx  >/dev/null 2>&1 || error "npx is required"

# Build
log "Compiling TypeScript..."
npx tsc --project src/telegram-bot/tsconfig.json

DIST="dist/telegram-bot"
[ -d "$DIST" ] || error "Build output not found at $DIST"

# Bundle package.json with only the needed deps
log "Preparing package.json for bot..."
node - <<'JS'
const fs   = require('fs');
const full = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const keep = ['telegraf', 'dotenv', '@prisma/client', 'prisma'];
const deps = {};
for (const k of keep) if (full.dependencies[k]) deps[k] = full.dependencies[k];
// prisma is a devDependency — pick it from there
if (!deps['prisma'] && full.devDependencies['prisma']) deps['prisma'] = full.devDependencies['prisma'];
const mini = {
  name: 'grocery-telegram-bot',
  version: full.version,
  main: 'index.js',
  scripts: { start: 'node index.js' },
  dependencies: deps,
};
fs.writeFileSync('dist/telegram-bot/package.json', JSON.stringify(mini, null, 2));
JS

# Copy PostgreSQL Prisma schema so the VPS can generate the client.
# NOTE: we keep the default `library` query engine here. The binary engine was
# evaluated as a workaround for the "PANIC: timer has gone away" Rust panic, but
# this VPS (~2 GB RAM, heavy swap) OOMs during `prisma generate`/`npm install`,
# and the binary engine adds a separate runtime process. The panic is instead
# handled in index.ts (eager $connect to avoid the startup race + exit-on-panic
# so PM2 restarts with a fresh engine).
log "Copying Prisma schema..."
cp prisma/schema.prisma dist/telegram-bot/schema.prisma

# Archive
ARCHIVE="dist/telegram-bot.tar.gz"
log "Archiving..."
tar -czf "$ARCHIVE" -C dist telegram-bot

# Upload + deploy in a single SSH connection (pipe archive via stdin; SSH reads password from TTY)
log "Uploading and deploying on $VPS_USER@$VPS_HOST ..."
cat "$ARCHIVE" | $SSH "$VPS_USER@$VPS_HOST" "
set -e
mkdir -p '$VPS_PATH'
cd '$VPS_PATH'
cat > telegram-bot.tar.gz
pm2 stop '$APP_NAME' 2>/dev/null || true
[ -f current/sessions.json ] && cp current/sessions.json sessions.json 2>/dev/null || true
[ -d current ] && mv current \"backup-\$(date +%Y%m%d_%H%M%S)\"
mkdir -p current
tar -xzf telegram-bot.tar.gz -C current --strip-components=1
rm telegram-bot.tar.gz
cd current
cp ../.env .env 2>/dev/null || echo 'Warning: no .env found'
cp ../sessions.json sessions.json 2>/dev/null || true
npm install --production
npx prisma generate --schema ./schema.prisma
if pm2 describe '$APP_NAME' > /dev/null 2>&1; then
  pm2 restart '$APP_NAME' --update-env
else
  pm2 start index.js --name '$APP_NAME'
fi
pm2 save
cd '$VPS_PATH'
ls -dt backup-* 2>/dev/null | tail -n +4 | xargs rm -rf 2>/dev/null || true
echo 'Bot deployed successfully!'
"

log "Done!"
log "Status: ssh $KEY_OPT -p $VPS_PORT $VPS_USER@$VPS_HOST 'pm2 status $APP_NAME'"
log "Logs:   ssh $KEY_OPT -p $VPS_PORT $VPS_USER@$VPS_HOST 'pm2 logs $APP_NAME'"
