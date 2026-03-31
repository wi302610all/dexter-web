/**
 * Alpaca Broker API Client
 *
 * Handles all communication with the Alpaca Trade API.
 * Supports both paper trading (https://paper-api.alpaca.markets)
 * and live trading (https://api.alpaca.markets).
 *
 * Environment variables required:
 *   ALPACA_API_KEY, ALPACA_API_SECRET, ALPACA_BASE_URL
 */

interface AlpacaConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
}

interface PlaceOrderParams {
  symbol: string;
  side: 'buy' | 'sell';
  qty: string;
  type?: 'market' | 'limit' | 'stop' | 'stop_limit';
  notional?: string;
  limit_price?: string;
  stop_price?: string;
  time_in_force?: string;
  stop_loss_pct?: number;
  take_profit_pct?: number;
}

export class AlpacaBrokerClient {
  private readonly config: AlpacaConfig;
  private readonly headers: Record<string, string>;

  constructor() {
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    const baseUrl = process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets';

    if (!apiKey || !apiSecret) {
      throw new Error(
        'Alpaca API credentials not configured. Set ALPACA_API_KEY and ALPACA_API_SECRET in your .env file.\n' +
        'Get free API keys at: https://app.alpaca.markets'
      );
    }

    this.config = { apiKey, apiSecret, baseUrl };
    this.headers = {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
      'Content-Type': 'application/json',
    };
  }

  // ---------------------------------------------------------------------------
  // Core HTTP methods
  // ---------------------------------------------------------------------------

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: { ...this.headers, ...options.headers },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `Alpaca API error ${response.status}: ${response.statusText}\n` +
        `Path: ${path}\n` +
        `Details: ${errorBody}`
      );
    }

    // Some endpoints return 204 No Content
    if (response.status === 204) {
      return { status: 'ok' } as T;
    }

    return response.json() as Promise<T>;
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  private async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Account
  // ---------------------------------------------------------------------------

  async getAccount(): Promise<AlpacaAccount> {
    return this.get<AlpacaAccount>('/v2/account');
  }

  // ---------------------------------------------------------------------------
  // Positions
  // ---------------------------------------------------------------------------

  async getPositions(): Promise<AlpacaPosition[]> {
    return this.get<AlpacaPosition[]>('/v2/positions');
  }

  async getPosition(symbol: string): Promise<AlpacaPosition | null> {
    try {
      return await this.get<AlpacaPosition>(`/v2/positions/${symbol}`);
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err.status === 404) return null;
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  async placeOrder(params: PlaceOrderParams): Promise<AlpacaOrder> {
    const body: Record<string, unknown> = {
      symbol: params.symbol,
      side: params.side,
      type: params.type ?? 'market',
      qty: params.qty,
      time_in_force: params.time_in_force ?? 'day',
    };

    if (params.notional) body.notional = params.notional;
    if (params.limit_price) body.limit_price = params.limit_price;
    if (params.stop_price) body.stop_price = params.stop_price;

    return this.post<AlpacaOrder>('/v2/orders', body);
  }

  /**
   * Place a bracket order: one parent + up to two child orders
   * (take_profit and/or stop_loss)
   */
  async placeBracketOrder(params: PlaceOrderParams): Promise<AlpacaOrder[]> {
    const entryPrice = params.limit_price
      ? parseFloat(params.limit_price)
      : await this.getLastPrice(params.symbol);

    const body: Record<string, unknown> = {
      symbol: params.symbol,
      side: params.side,
      type: 'market',
      qty: params.qty,
      time_in_force: params.time_in_force ?? 'day',
      order_class: 'bracket',
    };

    if (params.stop_loss_pct) {
      const stopPrice = (entryPrice * (1 - params.stop_loss_pct / 100)).toFixed(2);
      body.stop_loss = {
        stop_price: stopPrice,
        limit_price: (parseFloat(stopPrice) * 0.99).toFixed(2), // limit slightly below stop
      };
    }

    if (params.take_profit_pct) {
      const takeProfitPrice = (entryPrice * (1 + params.take_profit_pct / 100)).toFixed(2);
      body.take_profit = { limit_price: takeProfitPrice };
    }

    // Alpaca returns an array of orders [take_profit, stop_loss, parent]
    return this.post<AlpacaOrder[]>('/v2/orders', body);
  }

  async cancelOrder(orderId: string): Promise<string> {
    await this.delete<void>(`/v2/orders/${orderId}`);
    return `Order ${orderId} cancelled successfully.`;
  }

  async getOrders(
    status: 'open' | 'closed' | 'all' = 'open',
    limit: number = 50,
    symbols?: string[]
  ): Promise<AlpacaOrder[]> {
    const params = new URLSearchParams({
      status,
      limit: limit.toString(),
      ...(symbols ? { symbols: symbols.join(',') } : {}),
    });
    const orders = await this.get<AlpacaOrder[]>(`/v2/orders?${params.toString()}`);
    return orders;
  }

  async closePosition(symbol: string, qty?: string): Promise<string> {
    const path = qty
      ? `/v2/positions/${symbol}?qty=${encodeURIComponent(qty)}`
      : `/v2/positions/${symbol}`;
    await this.delete<void>(path);
    return `Position ${symbol}${qty ? ` (qty: ${qty})` : ' (full position)'} closed successfully.`;
  }

  // ---------------------------------------------------------------------------
  // Portfolio History
  // ---------------------------------------------------------------------------

  async getPortfolioHistory(
    period: string = '1M',
    timeframe: string = '1D'
  ): Promise<AlpacaPortfolioHistory> {
    const params = new URLSearchParams({ period, timeframe });
    const h = await this.get<{
      timestamp: number[];
      equity: string[];
      base_value: string;
    }>(`/v2/account/portfolio/history?${params.toString()}`);

    return {
      timestamp: h.timestamp,
      equity: h.equity.map(parseFloat),
      base_value: parseFloat(h.base_value),
      period,
      timeframe,
    };
  }

  // ---------------------------------------------------------------------------
  // Market Data (using data API v2)
  // ---------------------------------------------------------------------------

  async getLastPrice(symbol: string): Promise<number> {
    const dataKey = process.env.ALPACA_DATA_API_KEY ?? this.config.apiKey;
    const dataHeaders = {
      'APCA-API-KEY-ID': dataKey,
      'APCA-API-SECRET-KEY': this.config.apiSecret,
    };

    const url = `https://data.alpaca.markets/v2/stocks/${symbol}/trades/latest`;
    const response = await fetch(url, { headers: dataHeaders });
    if (!response.ok) {
      throw new Error(`Failed to get price for ${symbol}: ${response.statusText}`);
    }
    const data = await response.json() as { trade: { p: number } };
    return data.trade.p;
  }

  async getBars(
    symbols: string[],
    timeframe: string = '1Day',
    start: string,
    end: string
  ): Promise<Record<string, AlpacaBar[]>> {
    const dataKey = process.env.ALPACA_DATA_API_KEY ?? this.config.apiKey;
    const dataHeaders = {
      'APCA-API-KEY-ID': dataKey,
      'APCA-API-SECRET-KEY': this.config.apiSecret,
    };

    const params = new URLSearchParams({
      symbols: symbols.join(','),
      timeframe,
      start,
      end,
    });

    const url = `https://data.alpaca.markets/v2/stocks/bars?${params.toString()}`;
    const response = await fetch(url, { headers: dataHeaders });
    if (!response.ok) {
      throw new Error(`Failed to get bars: ${response.statusText}`);
    }
    const data = await response.json() as { bars: Record<string, AlpacaBar[]> };
    return data.bars;
  }

  // ---------------------------------------------------------------------------
  // Trading Config (Dexter-specific: not from Alpaca, from env)
  // ---------------------------------------------------------------------------

  getTradingConfig(): string {
    const mode = process.env.TRADING_MODE ?? 'paper';
    const autoTrade = process.env.AUTO_TRADE_ENABLED === 'true';
    const maxPosSize = parseFloat(process.env.MAX_POSITION_SIZE ?? '0.05') * 100;
    const maxDailyLoss = parseFloat(process.env.MAX_DAILY_LOSS ?? '0.02') * 100;
    const maxPortfolioLoss = parseFloat(process.env.MAX_PORTFOLIO_LOSS ?? '0.10') * 100;
    const maxOpenPos = process.env.MAX_OPEN_POSITIONS ?? '10';
    const defaultStopLoss = parseFloat(process.env.DEFAULT_STOP_LOSS_PCT ?? '0.05') * 100;

    const status = autoTrade ? '🟢 AUTO-TRADE ENABLED' : '🟡 AUTO-TRADE DISABLED (recommendations only)';
    const env = mode === 'paper'
      ? '🟡 PAPER TRADING (simulated, no real money)'
      : '🔴 LIVE TRADING (real money at risk!)';

    return `## Trading Configuration

### Status
- ${status}
- ${env}

### Risk Limits
| Parameter | Value |
|-----------|-------|
| Max Position Size | ${maxPosSize.toFixed(1)}% of portfolio |
| Max Daily Loss | ${maxDailyLoss.toFixed(1)}% (stop trading if exceeded) |
| Max Portfolio Loss | ${maxPortfolioLoss.toFixed(1)}% (stop trading if exceeded) |
| Max Open Positions | ${maxOpenPos} concurrent |
| Default Stop-Loss | ${defaultStopLoss.toFixed(1)}% |

### Actions
- To enable auto-trading: set AUTO_TRADE_ENABLED=true in .env
- To switch to live: set TRADING_MODE=live in .env (requires live trading approval)
- To update limits: use update_trading_config tool

> ⚠️ **Warning:** Past performance does not guarantee future results.
> Auto-trading involves real financial risk. Paper trade first.`;
  }

  updateTradingConfig(input: {
    auto_trade?: 'true' | 'false';
    max_position_size?: string;
    max_daily_loss?: string;
    max_portfolio_loss?: string;
    max_open_positions?: string;
    default_stop_loss_pct?: string;
    trading_mode?: 'paper' | 'live';
  }): string {
    const updates: string[] = [];

    if (input.auto_trade !== undefined) {
      process.env.AUTO_TRADE_ENABLED = input.auto_trade;
      updates.push(`AUTO_TRADE_ENABLED=${input.auto_trade}`);
    }
    if (input.max_position_size !== undefined) {
      process.env.MAX_POSITION_SIZE = input.max_position_size;
      updates.push(`MAX_POSITION_SIZE=${input.max_position_size}`);
    }
    if (input.max_daily_loss !== undefined) {
      process.env.MAX_DAILY_LOSS = input.max_daily_loss;
      updates.push(`MAX_DAILY_LOSS=${input.max_daily_loss}`);
    }
    if (input.max_portfolio_loss !== undefined) {
      process.env.MAX_PORTFOLIO_LOSS = input.max_portfolio_loss;
      updates.push(`MAX_PORTFOLIO_LOSS=${input.max_portfolio_loss}`);
    }
    if (input.max_open_positions !== undefined) {
      process.env.MAX_OPEN_POSITIONS = input.max_open_positions;
      updates.push(`MAX_OPEN_POSITIONS=${input.max_open_positions}`);
    }
    if (input.default_stop_loss_pct !== undefined) {
      process.env.DEFAULT_STOP_LOSS_PCT = input.default_stop_loss_pct;
      updates.push(`DEFAULT_STOP_LOSS_PCT=${input.default_stop_loss_pct}`);
    }
    if (input.trading_mode !== undefined) {
      process.env.TRADING_MODE = input.trading_mode;
      updates.push(`TRADING_MODE=${input.trading_mode}`);
    }

    if (updates.length === 0) {
      return 'No changes made. Provide at least one parameter to update.';
    }

    return `✅ Configuration updated for current session:\n${updates.map(u => `- ${u}`).join('\n')}\n\nNote: These changes apply to the current process only. ` +
      `For permanent changes, update your .env file.`;
  }

  // ---------------------------------------------------------------------------
  // Position Sizing Calculator
  // ---------------------------------------------------------------------------

  async calculatePosition(input: {
    symbol: string;
    entry_price?: string;
    stop_loss_pct?: string;
    target_allocation?: string;
  }): Promise<string> {
    const account = await this.getAccount();
    const equity = parseFloat(account.equity);
    const cash = parseFloat(account.cash);

    const maxPosSize = parseFloat(process.env.MAX_POSITION_SIZE ?? '0.05');
    const defaultStopLoss = parseFloat(process.env.DEFAULT_STOP_LOSS_PCT ?? '0.05');
    const maxPositions = parseInt(process.env.MAX_OPEN_POSITIONS ?? '10');
    const positions = await this.getPositions();

    const targetAlloc = input.target_allocation
      ? parseFloat(input.target_allocation)
      : maxPosSize;

    const entryPrice = input.entry_price
      ? parseFloat(input.entry_price)
      : await this.getLastPrice(input.symbol.toUpperCase());

    const stopLossPct = input.stop_loss_pct
      ? parseFloat(input.stop_loss_pct) / 100
      : defaultStopLoss;

    // Calculate position size
    const targetDollar = equity * targetAlloc;
    const shares = Math.floor(targetDollar / entryPrice);
    const actualDollar = shares * entryPrice;
    const riskDollar = actualDollar * stopLossPct;
    const riskPct = (riskDollar / equity) * 100;
    const newPortfolioPct = (actualDollar / equity) * 100;
    const currentExposure = positions.reduce((sum, p) => sum + parseFloat(p.market_value), 0);
    const totalExposurePct = ((currentExposure + actualDollar) / equity) * 100;

    // Risk/reward assessment
    const potentialGain = actualDollar * 0.10; // Assume 10% target
    const rrRatio = riskDollar > 0 ? (potentialGain / riskDollar) : 0;

    let riskLevel = '🟢 LOW';
    if (riskPct > 2) riskLevel = '🟡 MEDIUM';
    if (riskPct > 4) riskLevel = '🔴 HIGH';

    let status = '✅ APPROVED';
    if (shares === 0) status = '❌ REJECTED (insufficient capital)';
    else if (positions.length >= maxPositions) status = '⚠️ WARNING (max positions reached)';
    else if (newPortfolioPct > maxPosSize * 100 * 1.5) status = '❌ REJECTED (exceeds position limit)';
    else if (totalExposurePct > 80) status = '⚠️ WARNING (high portfolio concentration)';

    return `## Position Size Calculator

**Symbol:** ${input.symbol.toUpperCase()}
**Entry Price:** $${entryPrice.toFixed(2)}
**Stop-Loss:** -${(stopLossPct * 100).toFixed(1)}% → $${(entryPrice * (1 - stopLossPct)).toFixed(2)}

### Decision
${status}

### Recommended Trade
| Metric | Value |
|--------|-------|
| Shares | **${shares}** |
| Cost | $${actualDollar.toFixed(2)} (${newPortfolioPct.toFixed(1)}% of portfolio) |
| Stop-Loss Risk | $${riskDollar.toFixed(2)} (${riskPct.toFixed(2)}% of portfolio) |
| Risk Level | ${riskLevel} |

### Portfolio Impact
| Metric | Before | After |
|--------|--------|-------|
| Cash | $${cash.toFixed(2)} | $${(cash - actualDollar).toFixed(2)} |
| Equity | $${equity.toFixed(2)} | $${(equity).toFixed(2)} |
| Open Positions | ${positions.length}/${maxPositions} | ${positions.length + (shares > 0 ? 1 : 0)}/${maxPositions} |
| Total Exposure | ${((currentExposure / equity) * 100).toFixed(1)}% | ${totalExposurePct.toFixed(1)}% |

### Risk/Reward
- Risk per trade: $${riskDollar.toFixed(2)}
- Potential reward (10% target): $${potentialGain.toFixed(2)}
- Estimated R:R ratio: ${rrRatio.toFixed(1)}:1

> Always verify with your own analysis before executing.`;
  }
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  equity: string;
  last_equity: string;
  buying_power: string;
  crypto_buying_power: string;
  day_trade_count: number;
  pdt_status: string;
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_cost: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  change_today: string;
  side: string;
}

export interface AlpacaOrder {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: string;
  filled_qty: string;
  filled_avg_price: string;
  limit_price: string;
  stop_price: string;
  time_in_force: string;
  status: string;
  created_at: string;
  legs?: AlpacaOrder[];
}

export interface AlpacaPortfolioHistory {
  timestamp: number[];
  equity: number[];
  base_value: number;
  period: string;
  timeframe: string;
}

export interface AlpacaBar {
  t: string;      // timestamp
  o: number;      // open
  h: number;      // high
  l: number;      // low
  c: number;      // close
  v: number;      // volume
}
