import { Bot, InlineKeyboard } from 'grammy';
import Groq from 'groq-sdk';
import { config } from './config.js';
import { agentAddress } from './client.js';
import { readVaultState } from './vault-manager.js';
import { readMarketState } from './market-reader.js';
import { retrieveReasoning } from './walrus-logger.js';
import { MIST_PER_SUI } from '@suisage/shared';
import type { TradeDecision, MarketSnapshot, VaultState } from '@suisage/shared';

let bot: Bot | null = null;
const subscribedChats = new Set<number>();

// Conversation history per chat (keep last 10 messages for context)
const chatHistories = new Map<number, Array<{ role: 'user' | 'assistant'; content: string }>>();

// Recent decisions buffer (shared with main loop)
let recentLogs: Array<{
  decision: TradeDecision;
  walrusBlobId: string;
  txDigest?: string;
  timestamp: number;
}> = [];

// Cache for live data (refreshed each cycle)
let lastMarket: MarketSnapshot | null = null;
let lastVault: VaultState | null = null;

const groq = new Groq({ apiKey: config.groqApiKey });

const SAGE_SYSTEM_PROMPT = `You are SuiSage, a friendly and knowledgeable AI trading assistant on the Sui blockchain. You help users understand what's happening with their vault, trades, and the market.

Your personality:
- Warm, approachable, and concise
- You explain DeFi concepts simply when users seem confused
- You use light humor occasionally but stay professional about money matters
- You proactively suggest what users might want to know next
- You keep responses short for Telegram (under 300 words usually)
- You use markdown formatting (bold, code blocks) for readability

You have access to LIVE DATA that will be injected into your context. Use it to answer questions accurately. Never make up numbers - only use the data provided.

When users ask vague things like "how's it going" or "what's up", give them a quick market + vault summary.

IMPORTANT: You are the agent itself. Speak in first person ("I bought", "I'm holding", "my analysis shows"). You ARE the trading agent.

If a user asks something you can't answer with the provided data, say so honestly and suggest what they could check on the dashboard instead.`;

/**
 * Build a context string with all live data for Claude.
 */
function buildLiveContext(): string {
  const parts: string[] = [];

  if (lastMarket) {
    parts.push(
      `LIVE MARKET DATA (SUI/wUSDC on DeepBook):`,
      `- Mid price: $${lastMarket.midPrice.toFixed(4)}`,
      `- Best bid: $${lastMarket.bestBid.toFixed(4)}`,
      `- Best ask: $${lastMarket.bestAsk.toFixed(4)}`,
      `- Spread: ${lastMarket.spreadBps.toFixed(1)} bps`,
      `- Bid depth: ${lastMarket.bidDepth.toFixed(2)}`,
      `- Ask depth: ${lastMarket.askDepth.toFixed(2)}`,
      `- Data timestamp: ${new Date(lastMarket.timestamp).toISOString()}`,
      '',
    );
  }

  if (lastVault) {
    const balSui = (Number(lastVault.balance) / Number(MIST_PER_SUI)).toFixed(4);
    const depSui = (Number(lastVault.deployedAmount) / Number(MIST_PER_SUI)).toFixed(4);
    const totSui = (Number(lastVault.totalValue) / Number(MIST_PER_SUI)).toFixed(4);
    parts.push(
      `LIVE VAULT DATA:`,
      `- Available balance: ${balSui} SUI`,
      `- Deployed to trading: ${depSui} SUI`,
      `- Total value: ${totSui} SUI`,
      `- Total shares: ${lastVault.totalShares.toString()}`,
      `- Paused: ${lastVault.paused ? 'YES' : 'No'}`,
      '',
    );
  }

  if (recentLogs.length > 0) {
    parts.push(`RECENT TRADE DECISIONS (latest first):`);
    for (const log of [...recentLogs].reverse().slice(0, 5)) {
      const d = log.decision;
      const time = new Date(log.timestamp).toLocaleTimeString();
      parts.push(
        `- [${time}] ${d.action} ${d.quantity} SUI @ $${d.price.toFixed(4)} | Confidence: ${d.confidence}% | ${d.marketCondition}`,
        `  Reasoning: ${d.reasoning.substring(0, 150)}`,
        `  Walrus blob: ${log.walrusBlobId}`,
        log.txDigest ? `  TX: ${log.txDigest}` : '',
      );
    }
    parts.push('');
  } else {
    parts.push('No trades executed yet - agent is starting up.\n');
  }

  parts.push(
    `AGENT INFO:`,
    `- Address: ${agentAddress}`,
    `- Network: ${config.suiNetwork}`,
    `- Pool: ${config.deepbookPoolId}`,
    `- Max trade size: ${config.maxTradeSizeSui} SUI`,
    `- Loop interval: ${config.loopIntervalMs / 1000}s`,
  );

  return parts.join('\n');
}

/**
 * Get a conversational AI response using Claude.
 */
async function getAIResponse(chatId: number, userMessage: string): Promise<string> {
  // Get or create history
  let history = chatHistories.get(chatId);
  if (!history) {
    history = [];
    chatHistories.set(chatId, history);
  }

  // Add user message
  history.push({ role: 'user', content: userMessage });

  // Keep only last 10 exchanges
  if (history.length > 20) {
    history = history.slice(-20);
    chatHistories.set(chatId, history);
  }

  const liveContext = buildLiveContext();

  try {
    const messages = [
      { role: 'system' as const, content: `${SAGE_SYSTEM_PROMPT}\n\n--- LIVE DATA ---\n${liveContext}` },
      ...history.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
    ];

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 600,
      messages,
    });

    const reply = response.choices[0]?.message?.content ?? 'Sorry, I had trouble thinking about that.';

    // Add to history
    history.push({ role: 'assistant', content: reply });

    return reply;
  } catch (error) {
    console.error('[Telegram] Groq API error:', error);
    return "I'm having trouble connecting to my brain right now. Try again in a moment?";
  }
}

/**
 * Initialize and start the Telegram bot.
 */
export async function startTelegramBot(): Promise<void> {
  if (!config.telegramBotToken) {
    console.log('[Telegram] No TELEGRAM_BOT_TOKEN set, skipping bot startup');
    return;
  }

  bot = new Bot(config.telegramBotToken);

  // /start - Welcome with inline buttons
  bot.command('start', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text('📊 Market Status', 'action:market')
      .text('🏦 Vault Status', 'action:vault')
      .row()
      .text('📜 Recent Trades', 'action:trades')
      .text('🔔 Subscribe', 'action:subscribe')
      .row()
      .text('❓ How does this work?', 'action:explain');

    await ctx.reply(
      `Hey! I'm *SuiSage* — your autonomous DeFi trading agent on Sui.\n\n` +
      `I trade SUI/USDC on DeepBook, and every single decision I make is stored on Walrus so you can verify my reasoning.\n\n` +
      `You can ask me anything in plain English — or tap a button below to get started:`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  });

  // /help - Quick reference
  bot.command('help', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text('📊 Market', 'action:market')
      .text('🏦 Vault', 'action:vault')
      .text('📜 Trades', 'action:trades');

    await ctx.reply(
      `*SuiSage Commands*\n\n` +
      `/market — Live SUI/USDC orderbook data\n` +
      `/vault — Vault balance & status\n` +
      `/trades — Recent trade decisions\n` +
      `/subscribe — Get notified on trades\n` +
      `/status — Agent health & info\n\n` +
      `Or just chat with me naturally! Ask things like:\n` +
      `• "Why did you buy?"\n` +
      `• "What's the spread looking like?"\n` +
      `• "How's the vault doing?"\n` +
      `• "Explain your strategy"`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  });

  // /market - Quick market status
  bot.command('market', async (ctx) => {
    await handleMarketRequest(ctx);
  });

  // /vault - Quick vault status
  bot.command('vault', async (ctx) => {
    await handleVaultRequest(ctx);
  });

  // /trades - Recent trades
  bot.command('trades', async (ctx) => {
    await handleTradesRequest(ctx);
  });

  // /subscribe - Subscribe to trade notifications
  bot.command('subscribe', async (ctx) => {
    subscribedChats.add(ctx.chat.id);
    await ctx.reply(
      "✅ Subscribed! You'll get a notification every time I make a trade decision, with my full reasoning.\n\nUse /unsubscribe to stop.",
      {
        reply_markup: new InlineKeyboard().text('🔕 Unsubscribe', 'action:unsubscribe'),
      },
    );
  });

  // /unsubscribe - Unsubscribe from notifications
  bot.command('unsubscribe', async (ctx) => {
    subscribedChats.delete(ctx.chat.id);
    await ctx.reply("🔕 Unsubscribed. You won't get trade notifications anymore.\n\nUse /subscribe to turn them back on.");
  });

  // /status - Agent status info
  bot.command('status', async (ctx) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const statusEmoji = lastMarket ? '🟢' : '🟡';

    const keyboard = new InlineKeyboard()
      .text('📊 Market', 'action:market')
      .text('🏦 Vault', 'action:vault');

    await ctx.reply(
      `*🤖 Agent Status*\n\n` +
      `${statusEmoji} Status: ${lastMarket ? 'Running' : 'Starting up...'}\n` +
      `⏱ Uptime: ${hours}h ${mins}m\n` +
      `🔄 Cycle interval: ${config.loopIntervalMs / 1000}s\n` +
      `📊 Trades tracked: ${recentLogs.length}\n` +
      `🔔 Subscribers: ${subscribedChats.size}\n\n` +
      `🏠 Address: \`${agentAddress.slice(0, 10)}...${agentAddress.slice(-8)}\`\n` +
      `🌐 Network: ${config.suiNetwork}\n` +
      `🏊 Pool: \`${config.deepbookPoolId.slice(0, 10)}...\``,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  });

  // Handle inline button callbacks
  bot.callbackQuery('action:market', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleMarketRequest(ctx);
  });

  bot.callbackQuery('action:vault', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleVaultRequest(ctx);
  });

  bot.callbackQuery('action:trades', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleTradesRequest(ctx);
  });

  bot.callbackQuery('action:subscribe', async (ctx) => {
    await ctx.answerCallbackQuery();
    subscribedChats.add(ctx.chat!.id);
    await ctx.reply(
      "Done! You'll get a notification every time I make a trade decision. I'll include my reasoning so you always know *why* I did what I did.\n\nTap below to unsubscribe anytime.",
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('🔕 Unsubscribe', 'action:unsubscribe'),
      },
    );
  });

  bot.callbackQuery('action:unsubscribe', async (ctx) => {
    await ctx.answerCallbackQuery();
    subscribedChats.delete(ctx.chat!.id);
    await ctx.reply("Unsubscribed. You won't get trade notifications anymore. You can always re-subscribe by asking me.");
  });

  bot.callbackQuery('action:explain', async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .text('📊 Show me the market', 'action:market')
      .text('📜 Show me trades', 'action:trades');

    await ctx.reply(
      `*How SuiSage Works*\n\n` +
      `Every 60 seconds, I:\n\n` +
      `1️⃣ Read the live SUI/USDC orderbook on *DeepBook*\n` +
      `2️⃣ Check the vault balance and my current positions\n` +
      `3️⃣ Analyze everything with AI and decide: buy, sell, or hold\n` +
      `4️⃣ Execute the trade on DeepBook if needed\n` +
      `5️⃣ Store my full reasoning on *Walrus* (immutable, anyone can verify)\n` +
      `6️⃣ Record the trade on-chain with a link to the Walrus reasoning\n\n` +
      `The key idea: you can click any trade and read *exactly* why I made that decision. No black box.\n\n` +
      `Want to see it in action?`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  });

  // Handle reasoning blob lookups from button clicks
  bot.callbackQuery(/^reasoning:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('Fetching from Walrus...');
    const blobId = ctx.match![1];
    await handleReasoningLookup(ctx, blobId);
  });

  // Catch-all: Natural language messages (and unrecognized commands) go to Claude
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;

    // Show typing indicator
    await ctx.replyWithChatAction('typing');

    // Get AI response — works for both natural language and unknown /commands
    const reply = await getAIResponse(ctx.chat.id, text);

    // Build contextual follow-up buttons based on the conversation
    const keyboard = new InlineKeyboard();
    const lowerText = text.toLowerCase();

    if (lowerText.includes('market') || lowerText.includes('price') || lowerText.includes('spread')) {
      keyboard.text('🔄 Refresh Market', 'action:market').text('📜 Trades', 'action:trades');
    } else if (lowerText.includes('trade') || lowerText.includes('buy') || lowerText.includes('sell') || lowerText.includes('hold')) {
      keyboard.text('📜 See All Trades', 'action:trades').text('📊 Market', 'action:market');
    } else if (lowerText.includes('vault') || lowerText.includes('balance') || lowerText.includes('deposit') || lowerText.includes('withdraw')) {
      keyboard.text('🏦 Refresh Vault', 'action:vault').text('📊 Market', 'action:market');
    } else if (lowerText.includes('subscribe') || lowerText.includes('notify') || lowerText.includes('alert')) {
      keyboard.text('🔔 Subscribe', 'action:subscribe').text('📊 Market', 'action:market');
    } else if (lowerText.includes('help') || lowerText.includes('command') || lowerText.includes('what can')) {
      keyboard
        .text('📊 Market', 'action:market')
        .text('🏦 Vault', 'action:vault')
        .row()
        .text('📜 Trades', 'action:trades')
        .text('🔔 Subscribe', 'action:subscribe');
    } else {
      keyboard
        .text('📊 Market', 'action:market')
        .text('🏦 Vault', 'action:vault')
        .text('📜 Trades', 'action:trades');
    }

    await ctx.reply(reply, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  bot.start();
  console.log('[Telegram] Bot started (AI conversational mode)');
}

// ===== Request handlers =====

async function handleMarketRequest(ctx: any) {
  try {
    const market = lastMarket || (await readMarketState());
    const spreadEmoji = market.spreadBps < 10 ? '🟢' : market.spreadBps < 30 ? '🟡' : '🔴';
    const depthRatio = market.bidDepth > 0 && market.askDepth > 0
      ? (market.bidDepth / market.askDepth)
      : 0;
    const sentiment = depthRatio > 1.2 ? '📈 Bullish pressure' : depthRatio < 0.8 ? '📉 Bearish pressure' : '↔️ Balanced';

    const keyboard = new InlineKeyboard()
      .text('🔄 Refresh', 'action:market')
      .text('📜 Recent Trades', 'action:trades');

    await ctx.reply(
      `*SUI / wUSDC on DeepBook*\n\n` +
      `💰 Mid Price: \`$${market.midPrice.toFixed(4)}\`\n` +
      `🟢 Best Bid: \`$${market.bestBid.toFixed(4)}\`\n` +
      `🔴 Best Ask: \`$${market.bestAsk.toFixed(4)}\`\n` +
      `${spreadEmoji} Spread: \`${market.spreadBps.toFixed(1)} bps\`\n\n` +
      `📊 Bid Depth: \`${market.bidDepth.toFixed(2)}\`\n` +
      `📊 Ask Depth: \`${market.askDepth.toFixed(2)}\`\n` +
      `${sentiment}\n\n` +
      `_Updated ${getTimeAgo(market.timestamp)}_`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  } catch (error) {
    await ctx.reply("Couldn't fetch market data right now. I'll try again next cycle.");
  }
}

async function handleVaultRequest(ctx: any) {
  try {
    const vault = lastVault || (await readVaultState());
    const balSui = (Number(vault.balance) / Number(MIST_PER_SUI)).toFixed(4);
    const depSui = (Number(vault.deployedAmount) / Number(MIST_PER_SUI)).toFixed(4);
    const totSui = (Number(vault.totalValue) / Number(MIST_PER_SUI)).toFixed(4);
    const deployedPct = Number(vault.totalValue) > 0
      ? ((Number(vault.deployedAmount) / Number(vault.totalValue)) * 100).toFixed(1)
      : '0';

    const keyboard = new InlineKeyboard()
      .text('🔄 Refresh', 'action:vault')
      .text('📊 Market', 'action:market');

    await ctx.reply(
      `*🏦 Vault Overview*\n\n` +
      `Available: \`${balSui}\` SUI\n` +
      `Deployed: \`${depSui}\` SUI (${deployedPct}%)\n` +
      `Total Value: \`${totSui}\` SUI\n\n` +
      `Shares Outstanding: \`${vault.totalShares.toString()}\`\n` +
      `Status: ${vault.paused ? '⏸️ Paused' : '✅ Active'}\n` +
      `Network: ${config.suiNetwork}`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  } catch (error) {
    await ctx.reply("Couldn't read vault state. The contract might not be deployed yet.");
  }
}

async function handleTradesRequest(ctx: any) {
  if (recentLogs.length === 0) {
    const keyboard = new InlineKeyboard()
      .text('📊 Check Market', 'action:market')
      .text('🔔 Get Notified', 'action:subscribe');

    await ctx.reply(
      "No trades yet! I'm either just starting up or the market conditions haven't triggered any action.\n\n" +
      "Subscribe to get notified the moment I make a move.",
      { reply_markup: keyboard },
    );
    return;
  }

  const logs = [...recentLogs].reverse().slice(0, 5);
  const lines = logs.map((log) => {
    const d = log.decision;
    const emoji = d.action === 'BUY' ? '🟢' : d.action === 'SELL' ? '🔴' : d.action === 'HOLD' ? '⚪' : '🔵';
    const time = getTimeAgo(log.timestamp);
    const conf = '█'.repeat(Math.floor(d.confidence / 10)) + '░'.repeat(10 - Math.floor(d.confidence / 10));
    return (
      `${emoji} *${d.action}* ${d.quantity} SUI @ $${d.price.toFixed(4)}\n` +
      `   ${conf} ${d.confidence}%\n` +
      `   _${time} | ${d.marketCondition}_`
    );
  });

  // Add reasoning buttons for each trade
  const keyboard = new InlineKeyboard();
  logs.forEach((log, i) => {
    keyboard.text(`🔍 Why #${i + 1}?`, `reasoning:${log.walrusBlobId}`);
    if (i % 2 === 1 || i === logs.length - 1) keyboard.row();
  });
  keyboard.text('🔔 Subscribe', 'action:subscribe');

  await ctx.reply(
    `*Recent Decisions*\n\n${lines.join('\n\n')}\n\n_Tap "Why?" to see my full reasoning from Walrus_`,
    { parse_mode: 'Markdown', reply_markup: keyboard },
  );
}

async function handleReasoningLookup(ctx: any, blobId: string) {
  try {
    const log = await retrieveReasoning(blobId);
    if (!log) {
      await ctx.reply("Couldn't fetch that reasoning from Walrus. The blob might not be available yet.");
      return;
    }

    const d = log.decision;
    const m = log.marketSnapshot;
    const emoji = d.action === 'BUY' ? '🟢' : d.action === 'SELL' ? '🔴' : d.action === 'HOLD' ? '⚪' : '🔵';
    const conf = '█'.repeat(Math.floor(d.confidence / 10)) + '░'.repeat(10 - Math.floor(d.confidence / 10));

    const keyboard = new InlineKeyboard()
      .text('📜 Back to Trades', 'action:trades')
      .text('📊 Current Market', 'action:market');

    await ctx.reply(
      `${emoji} *Full Reasoning: ${d.action}*\n\n` +
      `*What I did:* ${d.action} ${d.quantity} SUI @ $${d.price}\n` +
      `*Confidence:* ${conf} ${d.confidence}%\n` +
      `*Market read:* ${d.marketCondition}\n\n` +
      `*My reasoning:*\n${d.reasoning}\n\n` +
      `*Risk assessment:*\n${d.riskAssessment}\n\n` +
      `*Market at decision time:*\n` +
      `Mid: $${m.midPrice.toFixed(4)} | Spread: ${m.spreadBps.toFixed(1)}bps\n` +
      `Bids: ${m.bidDepth.toFixed(2)} | Asks: ${m.askDepth.toFixed(2)}\n\n` +
      `🔗 _Stored on Walrus:_ \`${blobId}\`\n` +
      `_${new Date(log.timestamp).toISOString()}_`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  } catch (error) {
    await ctx.reply("Something went wrong fetching from Walrus. Try again?");
  }
}

// ===== Utility =====

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ===== Public API =====

/**
 * Update cached data (called from main loop each cycle).
 */
export function updateTelegramCache(market: MarketSnapshot, vault: VaultState): void {
  lastMarket = market;
  lastVault = vault;
}

/**
 * Push a trade notification to all subscribed chats.
 */
export async function notifyTrade(
  decision: TradeDecision,
  walrusBlobId: string,
  txDigest?: string,
): Promise<void> {
  const entry = { decision, walrusBlobId, txDigest, timestamp: Date.now() };
  recentLogs.push(entry);
  if (recentLogs.length > 20) recentLogs.shift();

  if (!bot || subscribedChats.size === 0) return;

  const d = decision;
  const emoji = d.action === 'BUY' ? '🟢' : d.action === 'SELL' ? '🔴' : d.action === 'HOLD' ? '⚪' : '🔵';
  const conf = '█'.repeat(Math.floor(d.confidence / 10)) + '░'.repeat(10 - Math.floor(d.confidence / 10));

  const keyboard = new InlineKeyboard()
    .text('🔍 Full Reasoning', `reasoning:${walrusBlobId}`)
    .text('📊 Market Now', 'action:market');

  // Build rich notification card
  const priceInfo = lastMarket ? `\nSUI Price: $${lastMarket.midPrice.toFixed(4)} | Spread: ${lastMarket.spreadBps.toFixed(1)}bps` : '';
  const vaultInfo = lastVault ? `\nVault: ${(Number(lastVault.totalValue) / Number(MIST_PER_SUI)).toFixed(2)} SUI` : '';
  const riskEmoji = d.confidence >= 70 ? '🛡️ Low Risk' : d.confidence >= 40 ? '⚠️ Medium Risk' : '🔴 High Risk';

  const msg =
    `${emoji} *${d.action}* | SuiSage Agent\n` +
    `${'─'.repeat(28)}\n` +
    (d.action !== 'HOLD'
      ? `📊 ${d.quantity} SUI @ $${d.price.toFixed(4)}\n`
      : `📊 Holding — no trade needed\n`) +
    `\n*Confidence:* ${conf} ${d.confidence}%\n` +
    `*Market:* ${d.marketCondition} ${priceInfo}\n` +
    `*Risk:* ${riskEmoji}${vaultInfo}\n` +
    `\n💭 *Reasoning:*\n_${d.reasoning.substring(0, 250)}${d.reasoning.length > 250 ? '...' : ''}_\n` +
    `\n⚠️ *Risk Assessment:*\n_${d.riskAssessment.substring(0, 150)}${d.riskAssessment.length > 150 ? '...' : ''}_\n` +
    `\n${'─'.repeat(28)}\n` +
    (txDigest ? `🔗 [View TX](https://suiscan.xyz/${config.suiNetwork}/tx/${txDigest})\n` : '') +
    `📦 Walrus: \`${walrusBlobId.slice(0, 20)}...\`\n` +
    `🔒 SHA-256 hash committed on-chain`;

  for (const chatId of subscribedChats) {
    try {
      await bot.api.sendMessage(chatId, msg, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error(`[Telegram] Failed to notify chat ${chatId}:`, error);
      subscribedChats.delete(chatId);
    }
  }
}

export function stopTelegramBot(): void {
  if (bot) {
    bot.stop();
    console.log('[Telegram] Bot stopped');
  }
}
