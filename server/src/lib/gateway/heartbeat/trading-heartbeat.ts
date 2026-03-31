/**
 * Trading Heartbeat Enhancement
 *
 * Extends the standard heartbeat to include autonomous trading tasks:
 * - Portfolio risk monitoring (daily loss, position limits)
 * - Open position monitoring (stop-loss proximity alerts)
 * - Agenda-based scheduled trading tasks
 * - Automatic market scanning (if agenda has "watch" items)
 *
 * This runs as part of the heartbeat loop, before the standard checklist.
 */
import { loadTradingConfig, saveTradingConfig, logTrade, type TradingAgendaItem } from '../../agent/autonomous-trading.js';
import { AlpacaBrokerClient } from '../../tools/trading/alpaca-client.js';

export interface TradingHeartbeatResult {
  alerts: string[];
  executedTrades: string[];
  skippedTrades: string[];
  errors: string[];
}

/**
 * Run the trading portion of the heartbeat.
 * Called before the standard checklist processing.
 */
export async function runTradingHeartbeat(): Promise<TradingHeartbeatResult> {
  const result: TradingHeartbeatResult = {
    alerts: [],
    executedTrades: [],
    skippedTrades: [],
    errors: [],
  };

  let client: AlpacaBrokerClient | null = null;

  try {
    client = new AlpacaBrokerClient();
  } catch {
    // Alpaca not configured — skip trading heartbeat
    return result;
  }

  const config = await loadTradingConfig();
  const today = new Date().toISOString().slice(0, 10);

  // Reset daily counters if new day
  if (config.lastTradeDate !== today) {
    config.dailyTradeCount = 0;
    config.dailyLoss = 0;
    config.lastTradeDate = today;
    await saveTradingConfig(config);
  }

  // ── 1. Account & Risk Check ────────────────────────────────────────────
  try {
    const account = await client.getAccount();
    const equity = parseFloat(account.equity);
    const cash = parseFloat(account.cash);

    // Alert: low buying power
    if (cash < equity * 0.05) {
      result.alerts.push(`⚠️ Low cash: $${cash.toFixed(2)} (${((cash / equity) * 100).toFixed(1)}% of portfolio). May limit new opportunities.`);
    }

    // Alert: Pattern Day Trader flag
    if (account.pdt_status === 'marked') {
      result.alerts.push('⚠️ Pattern Day Trader status active. Account is restricted to 3 day trades per rolling 5 business days.');
    }

    // Check daily loss
    if (config.dailyLoss / equity >= config.maxDailyLoss * 0.8) {
      result.alerts.push(`🔴 Daily loss at ${((config.dailyLoss / equity) * 100).toFixed(1)}% (limit: ${(config.maxDailyLoss * 100).toFixed(0)}%). Trading heavily restricted.`);
    }

  } catch (e: unknown) {
    result.errors.push(`Account check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 2. Position Monitoring ─────────────────────────────────────────────
  try {
    const positions = await client.getPositions();

    for (const pos of positions) {
      const currentPrice = parseFloat(pos.current_price);
      const avgCost = parseFloat(pos.avg_entry_cost);
      const unrealizedPL = parseFloat(pos.unrealized_pl);
      const pnlPct = ((currentPrice - avgCost) / avgCost) * 100;
      const changeToday = parseFloat(pos.change_today ?? '0') * 100;

      // Stop-loss proximity alert (within 10% of default stop)
      const stopLossLevel = avgCost * (1 - config.defaultStopLossPct);
      if (currentPrice <= stopLossLevel && currentPrice > avgCost * 0.95) {
        result.alerts.push(`🚨 ${pos.symbol}: Near stop-loss level ($${stopLossLevel.toFixed(2)}). Current $${currentPrice.toFixed(2)} — consider manual exit.`);
      }

      // Large intraday move alert
      if (Math.abs(changeToday) >= 5) {
        result.alerts.push(`${changeToday > 0 ? '🟢' : '🔴'} ${pos.symbol}: Intraday move ${changeToday > 0 ? '+' : ''}${changeToday.toFixed(1)}% | P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`);
      }

      // Update daily P&L tracking
      if (unrealizedPL < 0) {
        config.dailyLoss += Math.abs(unrealizedPL);
      }
    }

    // Max positions check
    if (positions.length >= config.maxOpenPositions) {
      result.alerts.push(`ℹ️ Max positions reached (${positions.length}/${config.maxOpenPositions}).`);
    }

  } catch (e: unknown) {
    result.errors.push(`Position check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 3. Pending Orders Check ────────────────────────────────────────────
  try {
    const openOrders = await client.getOrders('open', 20);
    if (openOrders.length > 0) {
      const orderSummary = openOrders
        .map(o => `${o.side.toUpperCase()} ${o.qty} ${o.symbol} @ ${o.limit_price ?? 'market'}`)
        .join(', ');
      result.alerts.push(`📋 Open orders: ${orderSummary}`);
    }
  } catch (e: unknown) {
    result.errors.push(`Orders check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 4. Agenda Items ────────────────────────────────────────────────────
  const pendingAgenda = config.tradingAgenda
    .filter(a => a.status === 'pending')
    .sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return p[a.priority] - p[b.priority];
    });

  if (pendingAgenda.length > 0) {
    const agendaSummary = pendingAgenda
      .slice(0, 3)
      .map(a => `[${a.priority.toUpperCase()}] ${a.action} ${a.symbol ?? 'market'}: ${a.notes ?? 'no notes'}`)
      .join(' | ');

    result.alerts.push(`📅 Trading agenda: ${agendaSummary}`);
  }

  // ── 5. Portfolio Performance ──────────────────────────────────────────
  try {
    const history = await client.getPortfolioHistory('1D', '1D');
    const baseValue = history.base_value;
    const latestEquity = history.equity[history.equity.length - 1];
    const dailyReturn = ((latestEquity - baseValue) / baseValue) * 100;

    if (Math.abs(dailyReturn) >= 1) {
      result.alerts.push(
        dailyReturn >= 0
          ? `📈 Portfolio: +${dailyReturn.toFixed(2)}% today ($${latestEquity.toFixed(2)})`
          : `📉 Portfolio: ${dailyReturn.toFixed(2)}% today ($${latestEquity.toFixed(2)})`
      );
    }
  } catch {
    // Non-critical — skip silently
  }

  // Save updated config
  await saveTradingConfig(config);

  return result;
}

/**
 * Add a default trading-focused heartbeat checklist for users
 * who want autonomous trading enabled.
 */
export const TRADING_HEARTBEAT_TEMPLATE = `## Market Overview
- S&P 500 move > 1.5% — alert
- Major indices (NASDAQ, Dow) — summary
- VIX level — if > 25 alert elevated volatility

## Watchlist Monitoring
- Check prices for all symbols on watchlist
- Alert on > 3% intraday moves

## Portfolio Health
- Overall portfolio P&L
- Check for positions near stop-loss
- Alert if any position down > 8%

## Open Orders
- Review pending orders status
- Cancel stale limit orders (> 3 days old)

## Trading Agenda
- Review and execute pending agenda items
- Add new opportunities from market scan`;
