#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=====================================================${NC}"
echo -e "${BLUE}  Sync Service (CQRS read model) - Entrypoint${NC}"
echo -e "${BLUE}=====================================================${NC}\n"

MONGO_HOST="${MONGO_HOST:-mongo}"
MONGO_PORT="${MONGO_PORT:-27017}"
RABBITMQ_HOST="${RABBITMQ_HOST:-rabbitmq}"
RABBITMQ_PORT="${RABBITMQ_PORT:-5672}"
SERVICE_NAME="${SERVICE_NAME:-sync}"

echo -e "${YELLOW}[INFO]${NC} Initializing $SERVICE_NAME service..."

# ─────────────────────────────────────────────────────────────
# STEP 1: Wait for MongoDB
# ─────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[STEP 1/4]${NC} Waiting for MongoDB ($MONGO_HOST:$MONGO_PORT)..."
until nc -zv "$MONGO_HOST" "$MONGO_PORT" >/dev/null 2>&1; do
  sleep 1
done
echo -e "${GREEN}✓ MongoDB is ready!${NC}"

# ─────────────────────────────────────────────────────────────
# STEP 2: Wait for RabbitMQ
# ─────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[STEP 2/4]${NC} Waiting for RabbitMQ ($RABBITMQ_HOST:$RABBITMQ_PORT)..."
until nc -zv "$RABBITMQ_HOST" "$RABBITMQ_PORT" >/dev/null 2>&1; do
  sleep 1
done
echo -e "${GREEN}✓ RabbitMQ is ready!${NC}"

# ─────────────────────────────────────────────────────────────
# STEP 3: Generate Prisma Client
# ─────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[STEP 3/4]${NC} Generating Prisma Client..."
if [ -f "prisma/schema.prisma" ]; then
  pnpm prisma:generate 2>&1 | sed 's/^/  /'
  echo -e "${GREEN}✓ Prisma Client generated!${NC}"
fi

# ─────────────────────────────────────────────────────────────
# STEP 4: Sync Mongo collections (idempotent prisma db push)
# Prisma with MongoDB only creates indexes/validators — collections
# themselves are created lazily on first write.
# ─────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[STEP 4/4]${NC} Syncing Mongo schema (prisma db push)..."
if [ -f "prisma/schema.prisma" ]; then
  if pnpm prisma:push 2>&1 | sed 's/^/  /'; then
    echo -e "${GREEN}✓ Mongo schema is in sync!${NC}"
  else
    echo -e "${RED}✗ CRITICAL: schema sync failed!${NC}"
    exit 1
  fi
fi

echo -e "\n${BLUE}=====================================================${NC}"
echo -e "${GREEN}🚀 Starting $SERVICE_NAME service...${NC}"
echo -e "${BLUE}=====================================================${NC}\n"

exec "$@"
