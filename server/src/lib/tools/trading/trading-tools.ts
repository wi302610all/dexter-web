/**
 * Alpaca Trading Tools - Core implementation
 * Connects Dexter to Alpaca Trade API for paper/live trading
 */
import { z } from 'zod';
import { StructuredToolInterface } from '@langchain/core/tools';
import { AlpacaBrokerClient } from './alpaca-client.js';

// ============================================================================
// Zod Schemas
// ============================================================================

export const GetAccountSchema = z.object({});
export const GetPositionsSchema = z.object({});
export const PlaceOrderSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol (e.g., "AAPL", "NVDA")'),
  side: z.enum(['buy', 'sell']).describe('Order side: buy or sell'),
  qty: z.string().describe('Number of shares to buy/sell'),
  order_type: z.enum(['market', 'limit', 'stop', 'stop_limit']).optional().default('market').describe('Order type'),
  limit_price: z.string().optional().describe('Limit price for limit orders'),
  stop_price: z.string().optional().describe('Stop price for stop orders'),
  time_in_force: z.enum(['day', 'gtc', 'ioc', 'fok']).optional().default('day').describe('Time in force'),
  take_profit_pct: z.string().optional().describe('Auto-sell percentage above entry (e.g., "15" for 15%)'),
  stop_loss_pct: z.string().optional().describe('Auto-sell percentage below entry (e.g., "5" for 5%)'),
  notional: z.string().optional().describe('Dollar amount instead of qty (e.g., "1000" for $1000)'),
  rationale: z.string().optional().describe('Why this trade is being made (for logging)'),
});
export const CancelOrderSchema = z.object({
  order_id: z.string().describe('The Alpaca order ID to cancel'),
});
export const GetOrdersSchema = z.object({
  status: z.enum(['open', 'closed', 'all']).optional().default('open').describe('Order status filter'),
  limit: z.string().optional().default('50').describe('Max number of orders'),
  symbols: z.string().optional().describe('Filter by comma-separated symbols'),
});
export const ClosePositionSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol to close'),
  qty: z.string().optional().describe('Number of shares to close (omit = close entire position)'),
  rationale: z.string().optional().describe('Why this position is being closed'),
});
export const GetPortfolioHistorySchema = z.object({
  period: z.enum(['1D', '1W', '1M', '3M', '1A', 'all']).optional().default('1M').describe('Time period'),
  timeframe: z.enum(['1Min', '5Min', '15Min', '1H', '1D']).optional().default('1D').describe('Data granularity'),
});
export const GetTradingConfigSchema = z.object({});
export const UpdateTradingConfigSchema = z.object({
  auto_trade: z.enum(['true', 'false']).optional().describe('Enable/disable auto-trading'),
  max_position_size: z.string().optional().describe('Max % per position (e.g., "0.05" for 5%)'),
  max_daily_loss: z.string().optional().describe('Daily loss threshold (e.g., "0.02" for 2%)'),
  max_portfolio_loss: z.string().optional().describe('Portfolio loss threshold (e.g., "0.10" for 10%)'),
  max_open_positions: z.string().optional().describe('Max concurrent positions'),
  default_stop_loss_pct: z.string().optional().describe('Default stop-loss %'),
  trading_mode: z.enum(['paper', 'live']).optional().describe('Trading mode'),
});
export const CalculatePositionSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol'),
  entry_price: z.string().optional().describe('Expected entry price'),
  stop_loss_pct: z.string().optional().describe('Stop-loss percentage'),
  target_allocation: z.string().optional().describe('Target % of portfolio'),
});

// ============================================================================
// Tool Factories (one per tool, matching existing pattern)
// ============================================================================

// Cached client instance
let _client: AlpacaBrokerClient | null = null;
function getClient(): AlpacaBrokerClient {
  if (!_client) {
    _client = new AlpacaBrokerClient();
  }
  return _client;
}

function createTool<I, O>(
  name: string,
  description: string,
  schema: z.ZodType<I>,
  execute: (input: I, client: AlpacaBrokerClient) => Promise<string>
): StructuredToolInterface {
  return {
    name,
    description,
    schema,
    async execute(input: unknown) {
      const parsed = schema.parse(input);
      const client = getClient();
      return execute(parsed as never, client);
    },
  } as StructuredToolInterface;
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export const GET_ACCOUNT_DESCRIPTION = '### get_account\n\nGet current account status including buying power, cash, and equity.';

export function createGetAccount() {
  return createTool(
    'get_account',
    GET_ACCOUNT_DESCRIPTION,
    GetAccountSchema,
    async (_input, client) => {
      const account = await client.getAccount();
      return formatAccount(account);
    }
  );
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export const GET_POSITIONS_DESCRIPTION = '### get_positions\n\nGet all current open positions with real-time P&L.';

export function createGetPositions() {
  return createTool(
    'get_positions',
    GET_POSITIONS_DESCRIPTION,
    GetPositionsSchema,
    async (_input, client) => {
      const positions = await client.getPositions();
      if (positions.length === 0) {
        return 'No open positions. Portfolio is 100% cash.';
      }
      return formatPositions(positions);
    }
  );
}

// ---------------------------------------------------------------------------
// Place Order
// ---------------------------------------------------------------------------

export const PLACE_ORDER_DESCRIPTION = '### place_order\n\nPlace a new order (market, limit, or with stop-loss).';

export function createPlaceOrder() {
  return createTool(
    'place_order',
    PLACE_ORDER_DESCRIPTION,
    PlaceOrderSchema,
    async (input, client) => {
      // Check auto-trade setting
      const autoTrade = process.env.AUTO_TRADE_ENABLED === 'true';

      // If auto-trade is disabled, return a recommendation instead of executing
      if (!autoTrade) {
        const orderPreview = formatOrderPreview(input);
        return `[AUTO-TRADE DISABLED] Order preview (requires approval to execute):\n\n${orderPreview}\n\nTo enable auto-trading, update your .env: AUTO_TRADE_ENABLED=true`;
      }

      // Execute the order
      const order = await client.placeOrder({
        symbol: input.symbol.toUpperCase(),
        side: input.side,
        type: input.order_type ?? 'market',
        qty: input.qty,
        notional: input.notional,
        limit_price: input.limit_price,
        stop_price: input.stop_price,
        time_in_force: input.time_in_force ?? 'day',
      });

      // Attach bracket orders (take-profit + stop-loss) if specified
      const childOrders: string[] = [];
      if ((input.side === 'buy') && (input.take_profit_pct || input.stop_loss_pct)) {
        const entryPrice = input.limit_price || await client.getLastPrice(input.symbol.toUpperCase());
        const bracket = await client.placeBracketOrder({
          symbol: input.symbol.toUpperCase(),
          side: input.side,
          qty: input.qty,
          stop_loss_pct: input.stop_loss_pct ? parseFloat(input.stop_loss_pct) : undefined,
          take_profit_pct: input.take_profit_pct ? parseFloat(input.take_profit_pct) : undefined,
          limit_price: input.limit_price,
          time_in_force: input.time_in_force ?? 'day',
        });
        childOrders.push(...bracket.map(o => `  ${o.side.toUpperCase()} ${o.qty} @ ${o.limit_price ?? 'market'}`));
      }

      return formatOrderResult(order, childOrders);
    }
  );
}

// ---------------------------------------------------------------------------
// Cancel Order
// ---------------------------------------------------------------------------

export const CANCEL_ORDER_DESCRIPTION = '### cancel_order\n\nCancel a pending order by its order ID.';

export function createCancelOrder() {
  return createTool(
    'cancel_order',
    CANCEL_ORDER_DESCRIPTION,
    CancelOrderSchema,
    async (input, client) => {
      const result = await client.cancelOrder(input.order_id);
      return result;
    }
  );
}

// ---------------------------------------------------------------------------
// Get Orders
// ---------------------------------------------------------------------------

export const GET_ORDERS_DESCRIPTION = '### get_orders\n\nGet all orders, optionally filtered by status.';

export function createGetOrders() {
  return createTool(
    'get_orders',
    GET_ORDERS_DESCRIPTION,
    GetOrdersSchema,
    async (input, client) => {
      const symbols = input.symbols?.split(',').map(s => s.trim().toUpperCase());
      const orders = await client.getOrders(
        input.status ?? 'open',
        parseInt(input.limit ?? '50'),
        symbols
      );
      if (orders.length === 0) {
        return `No ${input.status ?? 'open'} orders found.`;
      }
      return formatOrders(orders);
    }
  );
}

// ---------------------------------------------------------------------------
// Close Position
// ---------------------------------------------------------------------------

export const CLOSE_POSITION_DESCRIPTION = '### close_position\n\nClose (liquidate) an entire position by symbol.';

export function createClosePosition() {
  return createTool(
    'close_position',
    CLOSE_POSITION_DESCRIPTION,
    ClosePositionSchema,
    async (input, client) => {
      const result = await client.closePosition(input.symbol.toUpperCase(), input.qty);
      return result;
    }
  );
}

// ---------------------------------------------------------------------------
// Portfolio History
// ---------------------------------------------------------------------------

export const GET_PORTFOLIO_HISTORY_DESCRIPTION = '### get_portfolio_history\n\nGet portfolio value history for performance analysis.';

export function createGetPortfolioHistory() {
  return createTool(
    'get_portfolio_history',
    GET_PORTFOLIO_HISTORY_DESCRIPTION,
    GetPortfolioHistorySchema,
    async (input, client) => {
      const history = await client.getPortfolioHistory(
        input.period ?? '1M',
        input.timeframe ?? '1D'
      );
      return formatPortfolioHistory(history);
    }
  );
}

// ---------------------------------------------------------------------------
// Trading Config
// ---------------------------------------------------------------------------

export const GET_TRADING_CONFIG_DESCRIPTION = '### get_trading_config\n\nView current trading configuration and risk settings.';

export function createGetTradingConfig() {
  return createTool(
    'get_trading_config',
    GET_TRADING_CONFIG_DESCRIPTION,
    GetTradingConfigSchema,
    async (_input, client) => {
      return client.getTradingConfig();
    }
  );
}

export const UPDATE_TRADING_CONFIG_DESCRIPTION = '### update_trading_config\n\nUpdate trading configuration and risk settings.';

export function createUpdateTradingConfig() {
  return createTool(
    'update_trading_config',
    UPDATE_TRADING_CONFIG_DESCRIPTION,
    UpdateTradingConfigSchema,
    async (input, client) => {
      return client.updateTradingConfig(input);
    }
  );
}

// ---------------------------------------------------------------------------
// Calculate Position
// ---------------------------------------------------------------------------

export const CALCULATE_POSITION_DESCRIPTION = '### calculate_position\n\nCalculate the optimal position size based on risk parameters.';

export function createCalculatePosition() {
  return createTool(
    'calculate_position',
    CALCULATE_POSITION_DESCRIPTION,
    CalculatePositionSchema,
    async (input, client) => {
      return client.calculatePosition(input);
    }
  );
}

// ============================================================================
// Formatters
// ============================================================================

function formatAccount(a: AlpacaAccount): string {
  const cash = parseFloat(a.cash);
  const equity = parseFloat(a.equity);
  const buyingPower = parseFloat(a.buying_power);
  const dayTradeCount = a.day_trade_count ?? 0;
  const pnl = equity - parseFloat(a.last_equity);
  const pnlPct = parseFloat(a.last_equity) > 0 ? ((pnl / parseFloat(a.last_equity)) * 100).toFixed(2) : '0.00';

  return `## Account Status

| Field | Value |
|-------|-------|
| Account ID | ${a.id.slice(0, 12)}... |
| Status | ${a.status} ${a.pdt_status ? `(${a.pdt_status})` : ''} |
| Cash | $${cash.toLocaleString('en-US', { minimumFractionDigits: 2 })} |
| Equity | $${equity.toLocaleString('en-US', { minimumFractionDigits: 2 })} |
| Buying Power | $${buyingPower.toLocaleString('en-US', { minimumFractionDigits: 2 })} |
| Today's P&L | $${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} (${pnlPct}%) |
| Day Trades (5-day) | ${dayTradeCount}/5 |
| Crypto Buying Power | $${parseFloat(a.crypto_buying_power ?? '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function formatPositions(positions: AlpacaPosition[]): string {
  const lines = ['## Open Positions\n'];
  const header = '| Symbol | Qty | Avg Cost | Current | Mkt Value | P&L | P&L % | Today |';
  const sep = '|---|---|---|---|---|---|---|---|';
  lines.push(header, sep);

  let totalMktValue = 0;
  let totalPnl = 0;

  for (const p of positions) {
    const qty = parseFloat(p.qty);
    const avgCost = parseFloat(p.avg_entry_cost);
    const currentPrice = parseFloat(p.current_price);
    const marketValue = parseFloat(p.market_value);
    const pnl = parseFloat(p.unrealized_pl);
    const pnlPct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost * 100).toFixed(2) : '0.00';
    const todayPct = parseFloat(p.change_today ?? '0') * 100;
    totalMktValue += marketValue;
    totalPnl += pnl;

    lines.push(
      `| **${p.symbol}** | ${qty} | $${avgCost.toFixed(2)} | $${currentPrice.toFixed(2)} | $${marketValue.toFixed(2)} | $${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} | ${pnlPct >= '0' ? '+' : ''}${pnlPct}% | ${todayPct >= 0 ? '+' : ''}${todayPct.toFixed(2)}% |`
    );
  }

  const totalPnlPct = totalMktValue > 0 ? ((totalPnl / totalMktValue) * 100).toFixed(2) : '0.00';
  lines.push('\n**Summary:** ' +
    `Total Value: $${totalMktValue.toFixed(2)} | ` +
    `Total P&L: $${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} (${totalPnlPct}%)`
  );
  return lines.join('\n');
}

function formatOrders(orders: AlpacaOrder[]): string {
  const lines = ['## Orders\n'];
  const header = '| ID | Symbol | Side | Type | Qty | Filled | Price | Status | Created |';
  const sep = '|---|---|---|---|---|---|---|---|---|';
  lines.push(header, sep);

  for (const o of orders) {
    const created = new Date(o.created_at).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    lines.push(
      `| ${o.id.slice(0, 8)}... | **${o.symbol}** | ${o.side.toUpperCase()} | ${o.type} | ${o.qty} | ${o.filled_qty ?? 0} | $${o.filled_avg_price ?? o.limit_price ?? '-'} | ${o.status} | ${created} |`
    );
  }
  return lines.join('\n');
}

function formatOrderResult(order: AlpacaOrder, childOrders: string[]): string {
  const status = order.status === 'accepted' || order.status === 'new'
    ? '✅ ORDER SUBMITTED'
    : `📋 ${order.status.toUpperCase()}`;

  let msg = `## ${status}\n\n` +
    `| Field | Value |\n|---|---|\n` +
    `| Order ID | ${order.id} |\n` +
    `| Symbol | **${order.symbol}** |\n` +
    `| Side | ${order.side.toUpperCase()} |\n` +
    `| Type | ${order.type} |\n` +
    `| Qty | ${order.qty} shares |\n`;

  if (order.limit_price) {
    msg += `| Limit Price | $${order.limit_price} |\n`;
  }
  if (order.stop_price) {
    msg += `| Stop Price | $${order.stop_price} |\n`;
  }
  msg += `| Time in Force | ${order.time_in_force} |\n`;
  msg += `| Status | ${order.status} |\n`;
  msg += `| Created | ${new Date(order.created_at).toLocaleString()} |\n`;

  if (childOrders.length > 0) {
    msg += `\n### Bracket Orders (auto-attached)\n${childOrders.join('\n')}\n`;
  }

  return msg;
}

function formatOrderPreview(input: PlaceOrderInput): string {
  let msg = `**Preview - NOT executed:**\n\n` +
    `| Field | Value |\n|---|---|\n` +
    `| Symbol | **${input.symbol.toUpperCase()}** |\n` +
    `| Side | ${input.side.toUpperCase()} |\n` +
    `| Type | ${input.order_type ?? 'market'} |\n` +
    `| Qty | ${input.qty} shares |\n`;

  if (input.limit_price) msg += `| Limit Price | $${input.limit_price} |\n`;
  if (input.stop_loss_pct) msg += `| Stop-Loss | -${input.stop_loss_pct}% |\n`;
  if (input.take_profit_pct) msg += `| Take-Profit | +${input.take_profit_pct}% |\n`;
  if (input.rationale) msg += `| Rationale | ${input.rationale} |\n`;

  return msg;
}

function formatPortfolioHistory(h: AlpacaPortfolioHistory): string {
  const baseValue = h.base_value;
  const latestEquity = h.equity[h.equity.length - 1];
  const totalReturn = latestEquity - baseValue;
  const totalReturnPct = baseValue > 0 ? ((totalReturn / baseValue) * 100).toFixed(2) : '0.00';
  const maxEquity = Math.max(...h.equity);
  const minEquity = Math.min(...h.equity);
  const maxDrawdown = maxEquity > 0 ? (((maxEquity - minEquity) / maxEquity) * 100).toFixed(2) : '0.00';

  return `## Portfolio History

| Metric | Value |
|--------|-------|
| Period | ${h.timeframe} (${h.period ?? 'custom'}) |
| Base Value | $${baseValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} |
| Current Value | $${latestEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })} |
| Total Return | $${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)} (${totalReturnPct >= '0' ? '+' : ''}${totalReturnPct}%) |
| Max Value | $${maxEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })} |
| Min Value | $${minEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })} |
| Max Drawdown | -${maxDrawdown}% |

> Data points: ${h.equity.length} | Range: ${new Date(h.timestamp[0] * 1000).toLocaleDateString()} → ${new Date(h.timestamp[h.timestamp.length - 1] * 1000).toLocaleDateString()}`;
}

// ============================================================================
// Type Definitions (mirror Alpaca API response shapes)
// ============================================================================

interface AlpacaAccount {
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

interface AlpacaPosition {
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

interface AlpacaOrder {
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
}

interface AlpacaPortfolioHistory {
  timestamp: number[];
  equity: number[];
  base_value: number;
  period: string;
  timeframe: string;
}

// Input type for place_order
interface PlaceOrderInput {
  symbol: string;
  side: 'buy' | 'sell';
  qty: string;
  order_type?: 'market' | 'limit' | 'stop' | 'stop_limit';
  limit_price?: string;
  stop_price?: string;
  time_in_force?: string;
  notional?: string;
  take_profit_pct?: string;
  stop_loss_pct?: string;
  rationale?: string;
}
