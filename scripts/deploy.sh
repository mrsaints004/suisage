#!/bin/bash
set -e

# SuiSage Contract Deployment Script
# Usage: ./scripts/deploy.sh [mainnet|testnet]

NETWORK="${1:-mainnet}"
CONTRACTS_DIR="$(cd "$(dirname "$0")/../contracts" && pwd)"

echo ""
echo "============================================"
echo "  SuiSage Contract Deployment"
echo "  Network: $NETWORK"
echo "============================================"
echo ""

# Validate network
if [[ "$NETWORK" != "mainnet" && "$NETWORK" != "testnet" ]]; then
  echo "Error: Network must be 'mainnet' or 'testnet'"
  echo "Usage: ./scripts/deploy.sh [mainnet|testnet]"
  exit 1
fi

# Check sui CLI
if ! command -v sui &> /dev/null; then
  echo "Error: 'sui' CLI not found. Install it from https://docs.sui.io/build/install"
  exit 1
fi

# Get active address
ACTIVE_ADDRESS=$(sui client active-address 2>/dev/null || true)
if [[ -z "$ACTIVE_ADDRESS" ]]; then
  echo "Error: No active Sui address. Run 'sui client active-address' to configure."
  exit 1
fi
echo "Deploying from: $ACTIVE_ADDRESS"
echo "Network: $NETWORK"
echo ""

# Check balance
echo "Checking balance..."
sui client gas --json 2>/dev/null | head -5 || echo "(could not check gas)"
echo ""

# Step 1: Publish contracts
echo "[1/4] Publishing contracts..."
PUBLISH_OUTPUT=$(sui client publish "$CONTRACTS_DIR" \
  --gas-budget 200000000 \
  --json 2>&1)

# Extract package ID
PACKAGE_ID=$(echo "$PUBLISH_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for change in data.get('objectChanges', []):
    if change.get('type') == 'published':
        print(change['packageId'])
        break
" 2>/dev/null || echo "")

if [[ -z "$PACKAGE_ID" ]]; then
  echo "Error: Could not extract package ID from publish output."
  echo "Raw output:"
  echo "$PUBLISH_OUTPUT"
  exit 1
fi

echo "Package ID: $PACKAGE_ID"

# Step 2: Create vault
echo ""
echo "[2/4] Creating vault..."
VAULT_OUTPUT=$(sui client call \
  --package "$PACKAGE_ID" \
  --module vault \
  --function create_vault \
  --gas-budget 50000000 \
  --json 2>&1)

VAULT_OBJECT_ID=$(echo "$VAULT_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for change in data.get('objectChanges', []):
    if change.get('type') == 'created' and 'vault::Vault' in change.get('objectType', ''):
        print(change['objectId'])
        break
" 2>/dev/null || echo "")

echo "Vault Object ID: $VAULT_OBJECT_ID"

# Step 3: Create admin cap
echo ""
echo "[3/4] Creating admin cap..."
ADMIN_OUTPUT=$(sui client call \
  --package "$PACKAGE_ID" \
  --module agent_auth \
  --function create_admin_cap \
  --args "$VAULT_OBJECT_ID" \
  --gas-budget 50000000 \
  --json 2>&1)

ADMIN_CAP_ID=$(echo "$ADMIN_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for change in data.get('objectChanges', []):
    if change.get('type') == 'created' and 'AdminCap' in change.get('objectType', ''):
        print(change['objectId'])
        break
" 2>/dev/null || echo "")

echo "Admin Cap ID: $ADMIN_CAP_ID"

# Step 4: Authorize agent
echo ""
echo "[4/4] Authorizing agent..."

# Read agent address from .env if exists, otherwise use active address
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
AGENT_ADDRESS=""
if [[ -f "$ENV_FILE" ]]; then
  AGENT_ADDRESS=$(grep "^AGENT_ADDRESS=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)
fi
if [[ -z "$AGENT_ADDRESS" ]]; then
  AGENT_ADDRESS="$ACTIVE_ADDRESS"
fi

# Max trade size: 10 SUI = 10_000_000_000 MIST
# Max deployment: 50% = 5000 bps
AGENT_OUTPUT=$(sui client call \
  --package "$PACKAGE_ID" \
  --module agent_auth \
  --function authorize_agent \
  --args "$ADMIN_CAP_ID" "$VAULT_OBJECT_ID" "$AGENT_ADDRESS" "10000000000" "5000" \
  --gas-budget 50000000 \
  --json 2>&1)

AGENT_CAP_ID=$(echo "$AGENT_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for change in data.get('objectChanges', []):
    if change.get('type') == 'created' and 'AgentCap' in change.get('objectType', ''):
        print(change['objectId'])
        break
" 2>/dev/null || echo "")

echo "Agent Cap ID: $AGENT_CAP_ID"

# Print summary
echo ""
echo "============================================"
echo "  Deployment Complete!"
echo "============================================"
echo ""
echo "Add these to your .env file:"
echo ""
echo "VAULT_PACKAGE_ID=$PACKAGE_ID"
echo "VAULT_OBJECT_ID=$VAULT_OBJECT_ID"
echo "AGENT_CAP_ID=$AGENT_CAP_ID"
echo ""
echo "Also created (save for admin operations):"
echo "ADMIN_CAP_ID=$ADMIN_CAP_ID"
echo ""
echo "Next steps:"
echo "  1. Copy the values above into your .env"
echo "  2. Fund your agent wallet with SUI"
echo "  3. Run: npx pnpm agent:dev"
echo ""
