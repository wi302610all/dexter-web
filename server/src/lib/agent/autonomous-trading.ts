/**
 * Autonomous Trading Agent - The "Auto-Pilot" for Dexter
 *
 * This module enables fully autonomous trading by:
 * 1. Periodically scanning the market for opportunities
 * 2. Running DCF/fundamental analysis on candidates
 * 3. Applying risk management rules
 * 4. Executing trades automatically (or generating recommendations)
 *
 * Usage:
 *   - Triggered by heartbeat or scheduled tasks
 *   - Uses existing Agent + tools infrastructure
 *   - All trades go through AlpacaBrokerClient (respects risk limits)
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dexterPath } from '../utils/paths.js';

// ============================================================================
// Types
// ============================================================================

export interface TradingSignal {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;       // 0-1
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  quantity?: number;
  rationale: string;
  timestamp: string;
}

export interface AutoTradeConfig {
  enabled: boolean;
  mode: 'paper' | 'live';
  maxPositionSize: number;       // fraction of portfolio
  maxDailyLoss: number;
  maxPortfolioLoss: number;
  maxOpenPositions: number;
  defaultStopLossPct: number;
  minConfidence: number;          // minimum confidence to execute (0-1)
  tradingAgenda: TradingAgendaItem[];
  lastTradeDate?: string;
  dailyTradeCount: number;
  dailyLoss: number;
}

export interface TradingAgendaItem {
  id: string;
  symbol?: string;               // specific stock or undefined for broad scan
  action: 'watch' | 'buy' | 'sell' | 'review';
  status: 'pending' | 'completed' | 'skipped';
  notes?: string;
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  completedAt?: string;
}

export interface TradingLogEntry {
  timestamp: string;
  type: 'signal' | 'order' | 'review' | 'error' | 'risk_check';
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Config Management
// ============================================================================

const TRADING_CONFIG_PATH = () => dexterPath('.dexter', 'trading-config.json');

export async function loadTradingConfig(): Promise<AutoTradeConfig> {
  const defaultConfig: AutoTradeConfig = {
    enabled: process.env.AUTO_TRADE_ENABLED === 'true',
    mode: (process.env.TRADING_MODE as 'paper' | 'live') ?? 'paper',
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE ?? '0.05'),
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS ?? '0.02'),
    maxPortfolioLoss: parseFloat(process.env.MAX_PORTFOLIO_LOSS ?? '0.10'),
    maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS ?? '10'),
    defaultStopLossPct: parseFloat(process.env.DEFAULT_STOP_LOSS_PCT ?? '0.05'),
    minConfidence: 0.7,
    tradingAgenda: [],
    dailyTradeCount: 0,
    dailyLoss: 0,
  };

  try {
    const content = await readFile(TRADING_CONFIG_PATH(), 'utf-8');
    const saved = JSON.parse(content) as Partial<AutoTradeConfig>;
    // Reset daily counters if it's a new day
    const today = new Date().toISOString().slice(0, 10);
    const isNewDay = saved.lastTradeDate !== today;
    return {
      ...defaultConfig,
      ...saved,
      dailyTradeCount: isNewDay ? 0 : saved.dailyTradeCount ?? 0,
      dailyLoss: isNewDay ? 0 : saved.dailyLoss ?? 0,
    };
  } catch {
    return defaultConfig;
  }
}

export async function saveTradingConfig(config: AutoTradeConfig): Promise<void> {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const path = TRADING_CONFIG_PATH();
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch { /* exists */ }
  await writeFile(path, JSON.stringify(config, null, 2), 'utf-8');
}

// ============================================================================
// Risk Checks (gatekeepers before any order)
// ============================================================================

export async function runRiskChecks(
  config: AutoTradeConfig,
  account: { equity: number; cash: number },
  positions: { symbol: string; unrealized_pl: number }[]
): Promise<{ passed: boolean; reason?: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const totalEquity = parseFloat(account.equity);
  const cash = parseFloat(account.cash);

  // Check 1: Auto-trade enabled?
  if (!config.enabled) {
    return { passed: false, reason: 'Auto-trading is disabled. Enable with AUTO_TRADE_ENABLED=true' };
  }

  // Check 2: Daily loss limit
  if (config.dailyLoss / totalEquity >= config.maxDailyLoss) {
    return { passed: false, reason: `Daily loss limit reached (${(config.dailyLoss / totalEquity * 100).toFixed(2)}% / ${(config.maxDailyLoss * 100).toFixed(0)}%). Trading paused for today.` };
  }

  // Check 3: Portfolio loss limit
  const realizedPL = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pl), 0);
  if ((realizedPL / totalEquity) <= -config.maxPortfolioLoss) {
    return { passed: false, reason: `Portfolio loss limit reached. All trading suspended.` };
  }

  // Check 4: Max positions
  if (positions.length >= config.maxOpenPositions) {
    return { passed: false, reason: `Max positions reached (${positions.length}/${config.maxOpenPositions}). Cannot open new positions.` };
  }

  // Check 5: Sufficient cash
  if (cash < totalEquity * 0.01) {
    return { passed: false, reason: 'Insufficient buying power (< 1% cash).' };
  }

  // Check 6: Paper mode warning for live-like actions
  if (config.mode === 'paper') {
    // Paper mode is fine, just log
  }

  return { passed: true };
}

// ============================================================================
// Trading Agenda Management
// ============================================================================

export async function getTradingAgenda(): Promise<TradingAgendaItem[]> {
  const config = await loadTradingConfig();
  return config.tradingAgenda.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

export async function addToAgenda(item: Omit<TradingAgendaItem, 'id' | 'createdAt' | 'status'>): Promise<TradingAgendaItem> {
  const config = await loadTradingConfig();
  const newItem: TradingAgendaItem = {
    ...item,
    id: `agenda-${Date.now()}`,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  config.tradingAgenda.push(newItem);
  await saveTradingConfig(config);
  return newItem;
}

export async function updateAgendaItem(
  id: string,
  update: Partial<Pick<TradingAgendaItem, 'status' | 'notes' | 'completedAt'>>
): Promise<void> {
  const config = await loadTradingConfig();
  const item = config.tradingAgenda.find(a => a.id === id);
  if (item) {
    Object.assign(item, update);
    if (update.status === 'completed' || update.status === 'skipped') {
      item.completedAt = new Date().toISOString();
    }
    await saveTradingConfig(config);
  }
}

// ============================================================================
// Logging
// ============================================================================

const TRADING_LOG_PATH = () => dexterPath('.dexter', 'trading-log.md');

export async function logTrade(entry: TradingLogEntry): Promise<void> {
  const { appendFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const logPath = TRADING_LOG_PATH();
  try {
    await mkdir(dirname(logPath), { recursive: true });
  } catch { /* exists */ }

  const mdLine = `| ${entry.timestamp} | ${entry.type} | ${entry.message}${entry.details ? ` | ${JSON.stringify(entry.details)}` : ''} |\n`;
  const header = '| Time | Type | Message | Details |\n|---|---|---|---|\n';

  try {
    const { readFile } = await import('node:fs/promises');
    const existing = await readFile(logPath, 'utf-8').catch(() => '');
    const hasHeader = existing.includes('| Time | Type | Message');
    await appendFile(logPath, hasHeader ? mdLine : header + mdLine, 'utf-8');
  } catch {
    await appendFile(logPath, header + mdLine, 'utf-8');
  }
}

// ============================================================================
// Signal Generation (delegates to Agent + tools)
// ============================================================================

/**
 * Generate a trading signal using the Agent's research tools.
 * This is the "thinking" phase before execution.
 */
export async function generateSignal(
  symbol: string,
  agentRunFn: (query: string) => AsyncGenerator<unknown>
): Promise<TradingSignal> {
  const timestamp = new Date().toISOString();

  // Run DCF valuation through the agent
  let dcfResult = '';
  let newsResult = '';
  let fundamentals = '';

  const agentQuery = `Analyze ${symbol} for investment:

1. Get current market data and price
2. Run a DCF valuation to estimate intrinsic value
3. Check recent news and insider trading
4. Assess P/E, P/B, debt/equity ratios
5. Compare current price to DCF fair value

Conclude with: BUY / SELL / HOLD and specific price targets.`;

  for await (const event of agentRunFn(agentQuery)) {
    if (event.type === 'done') {
      dcfResult = event.answer ?? '';
    }
  }

  // Parse the result to extract signal
  const signal = parseAgentSignal(symbol, dcfResult, timestamp);
  return signal;
}

/**
 * Parse agent output into a structured TradingSignal
 */
function parseAgentSignal(symbol: string, agentOutput: string, timestamp: string): TradingSignal {
  const upper = agentOutput.toUpperCase();

  // Extract recommendation
  let action: 'buy' | 'sell' | 'hold' = 'hold';
  if (upper.includes('BUY') && !upper.includes('NOT BUY')) action = 'buy';
  else if (upper.includes('SELL') && !upper.includes('NOT SELL')) action = 'sell';

  // Extract confidence (look for percentage or qualitative terms)
  let confidence = 0.5;
  if (upper.includes('STRONG BUY') || upper.includes('HIGHLY CONFIDENT')) confidence = 0.9;
  else if (upper.includes('BUY') && !upper.includes('WEAK')) confidence = 0.75;
  else if (upper.includes('WEAK BUY') || upper.includes('CAUTIOUS')) confidence = 0.55;
  else if (upper.includes('HOLD')) confidence = 0.5;
  else if (upper.includes('WEAK SELL')) confidence = 0.6;
  else if (upper.includes('SELL')) confidence = 0.7;

  // Extract prices
  const priceMatch = agentOutput.match(/\$\s*([\d,]+(?:\.\d+)?)/g);
  const prices = priceMatch?.map(p => parseFloat(p.replace(/[$,\s]/g, ''))) ?? [];
  const currentPrice = prices[0];
  const targetPrice = prices.length > 1 ? prices[1] : currentPrice ? currentPrice * 1.15 : undefined;
  const stopLoss = currentPrice ? currentPrice * 0.95 : undefined;

  return {
    symbol,
    action,
    confidence,
    entryPrice: currentPrice,
    targetPrice,
    stopLoss,
    rationale: agentOutput.slice(0, 500) + (agentOutput.length > 500 ? '...' : ''),
    timestamp,
  };
}

// ============================================================================
// Trade Execution Engine
// ============================================================================

export interface ExecutionResult {
  success: boolean;
  orderId?: string;
  signal: TradingSignal;
  error?: string;
  skipped: boolean;
  skipReason?: string;
}

/**
 * Execute a trading signal through Alpaca
 */
export async function executeSignal(
  signal: TradingSignal,
  brokerClient: import('../tools/trading/alpaca-client.js').AlpacaBrokerClient,
  config: AutoTradeConfig
): Promise<ExecutionResult> {
  // Skip if confidence is too low
  if (signal.confidence < config.minConfidence) {
    return {
      success: false,
      signal,
      skipped: true,
      skipReason: `Confidence ${(signal.confidence * 100).toFixed(0)}% below threshold ${(config.minConfidence * 100).toFixed(0)}%`,
    };
  }

  // Skip sell/hold in auto mode (be conservative - only buy autonomously)
  if (signal.action !== 'buy') {
    return {
      success: false,
      signal,
      skipped: true,
      skipReason: `Action is ${signal.action.toUpperCase()}, not BUY. No automatic sell execution in auto mode.`,
    };
  }

  // Run risk checks
  const account = await brokerClient.getAccount();
  const positions = await brokerClient.getPositions();
  const riskCheck = await runRiskChecks(config, account, positions);

  if (!riskCheck.passed) {
    return {
      success: false,
      signal,
      skipped: true,
      skipReason: riskCheck.reason,
    };
  }

  // Calculate position size
  const equity = parseFloat(account.equity);
  const positionSize = equity * config.maxPositionSize;
  const entryPrice = signal.entryPrice ?? (await brokerClient.getLastPrice(signal.symbol));
  const quantity = Math.floor(positionSize / entryPrice);

  if (quantity === 0) {
    return {
      success: false,
      signal,
      skipped: true,
      skipReason: `Insufficient buying power. Need $${entryPrice.toFixed(2)}/share, have $${equity.toFixed(2)}`,
    };
  }

  try {
    // Place order with stop-loss
    const order = await brokerClient.placeBracketOrder({
      symbol: signal.symbol,
      side: 'buy',
      qty: quantity.toString(),
      stop_loss_pct: config.defaultStopLossPct * 100,
      take_profit_pct: config.defaultStopLossPct * 200, // 2:1 reward/risk
      time_in_force: 'day',
    });

    // Log the trade
    await logTrade({
      timestamp: new Date().toISOString(),
      type: 'order',
      message: `BUY ${quantity} ${signal.symbol} @ $${entryPrice.toFixed(2)}`,
      details: {
        orderId: order[0]?.id ?? order.id,
        confidence: signal.confidence,
        stopLoss: signal.stopLoss,
        targetPrice: signal.targetPrice,
      },
    });

    return {
      success: true,
      orderId: order[0]?.id ?? order.id,
      signal,
    };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    await logTrade({
      timestamp: new Date().toISOString(),
      type: 'error',
      message: `Failed to execute ${signal.symbol}: ${error}`,
    });
    return { success: false, signal, error };
  }
}

// ============================================================================
// Market Scan (periodic opportunity detection)
// ============================================================================

/**
 * Scan the market for investment opportunities based on criteria.
 * Returns symbols ranked by potential.
 */
export async function scanForOpportunities(
  criteria: {
    maxPE?: number;
    minGrowth?: number;
    maxDebtEquity?: number;
    minMarketCap?: number;
    sector?: string;
  },
  agentRunFn: (query: string) => AsyncGenerator<unknown>
): Promise<string[]> {
  const screenerQuery = `Screen for stocks matching these criteria:
- P/E ratio below ${criteria.maxPE ?? 25}
- Revenue growth above ${criteria.minGrowth ?? 15}%
- Debt/Equity below ${criteria.maxDebtEquity ?? 0.5}
${criteria.sector ? `- Sector: ${criteria.sector}` : ''}
- Market cap above $${((criteria.minMarketCap ?? 1) / 1e9).toFixed(0)}B

Return the top 5 tickers ranked by overall score with their key metrics.`;

  let result = '';
  for await (const event of agentRunFn(screenerQuery)) {
    if (event.type === 'done') result = event.answer ?? '';
  }

  // Extract ticker symbols from result
  const tickerRegex = /\b([A-Z]{1,5})\b/g;
  const matches = result.match(tickerRegex) ?? [];
  // Filter out common non-ticker words
  const exclude = new Set(['USD', 'CEO', 'CFO', 'API', 'SEC', 'ETF', 'NYSE', 'DCF', 'ROI', 'EPS', 'P/E', 'P/B']);
  const tickers = [...new Set(matches)].filter(t => !exclude.has(t)).slice(0, 5);

  await logTrade({
    timestamp: new Date().toISOString(),
    type: 'review',
    message: `Market scan found: ${tickers.join(', ') || 'none'}`,
    details: { criteria, result: result.slice(0, 200) },
  });

  return tickers;
}
