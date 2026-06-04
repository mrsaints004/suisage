import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEEPBOOK_SUI_USDC_POOL } from '@suisage/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optionalEnv(name: string, defaultVal: string): string {
  return process.env[name] || defaultVal;
}

export const config = {
  // Sui
  suiNetwork: optionalEnv('SUI_NETWORK', 'mainnet') as 'testnet' | 'mainnet' | 'devnet',
  suiRpcUrl: optionalEnv('SUI_RPC_URL', 'https://fullnode.mainnet.sui.io:443'),
  agentPrivateKey: requireEnv('AGENT_PRIVATE_KEY'),

  // Contract addresses
  vaultPackageId: requireEnv('VAULT_PACKAGE_ID'),
  vaultObjectId: requireEnv('VAULT_OBJECT_ID'),
  agentCapId: requireEnv('AGENT_CAP_ID'),
  strategyConfigId: requireEnv('STRATEGY_CONFIG_ID'),

  // DeepBook V2
  deepbookPackageId: optionalEnv('DEEPBOOK_PACKAGE_ID', '0xdee9'),
  deepbookPoolId: optionalEnv('DEEPBOOK_POOL_ID', DEEPBOOK_SUI_USDC_POOL),
  accountCapId: optionalEnv('ACCOUNT_CAP_ID', ''),

  // Walrus
  walrusAggregatorUrl: optionalEnv('WALRUS_AGGREGATOR_URL', 'https://aggregator.walrus-testnet.walrus.space'),
  walrusPublisherUrl: optionalEnv('WALRUS_PUBLISHER_URL', 'https://publisher.walrus-testnet.walrus.space'),

  // Claude
  anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),

  // Telegram
  telegramBotToken: optionalEnv('TELEGRAM_BOT_TOKEN', ''),

  // Agent settings
  loopIntervalMs: parseInt(optionalEnv('AGENT_LOOP_INTERVAL_MS', '60000'), 10),
  maxTradeSizeSui: parseInt(optionalEnv('MAX_TRADE_SIZE_SUI', '10'), 10),
};

export type Config = typeof config;
