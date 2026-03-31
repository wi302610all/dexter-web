/**
 * Rich tool descriptions for the trading module.
 * These are injected into the system prompt.
 */

export const TRADING_TOOL_DESCRIPTION = `### trading (ALPACA_TRADING group)

PLACEHOLDER - see individual tool descriptions below.
When the user asks about placing orders, managing positions, checking account status,
or any trading-related action, use the appropriate individual tool.`;

export const TRADING_MODE_DESCRIPTION = `### trading_mode

Check the current trading mode (paper or live) and whether auto-trading is enabled.

**When to use:**
- User asks "are you in paper mode or live mode?"
- Before any trading action to confirm the environment

**Returns:**
- Current mode (paper/live)
- Auto-trade status (enabled/disabled)
- API connection status

**Important:** If auto-trade is disabled, any buy/sell recommendations will be
flagged for human approval before execution.`;

export const RISK_LIMITS_DESCRIPTION = `### risk_limits

View current risk management settings and portfolio exposure.

**When to use:**
- Before placing a new order to verify it respects risk limits
- After significant market moves to check current exposure
- When asked about portfolio risk management

**Returns:**
- Max position size (% of portfolio)
- Max daily loss threshold
- Max portfolio loss threshold
- Current open positions count
- Portfolio-level P&L

**Critical rule:** Never recommend or execute a trade that violates these limits.`;

export const GET_ACCOUNT_DESCRIPTION = `### get_account

Get current account status including buying power, cash, and equity.

**When to use:**
- Before placing orders to check available capital
- When asked about account balance or buying power
- For portfolio-level cash management

**Returns:**
- Account ID, status (ACTIVE/DAY_TRADE)
- Cash balance
- Portfolio equity (real-time market value)
- Buying power (2x cash for intraday)
- Pattern Day Trader flag`;

export const GET_POSITIONS_DESCRIPTION = `### get_positions

Get all current open positions with real-time P&L.

**When to use:**
- Portfolio review requests
- Before opening new positions (check existing exposure)
- After market close to review day's performance

**Returns:**
- List of all open positions with:
  - Symbol, quantity, market value
  - Current price, cost basis, unrealized P&L
  - P&L as percentage
  - Average entry price, today's change %`;

export const PLACE_ORDER_DESCRIPTION = `### place_order

Place a new order (market, limit, or with stop-loss).

**When to use:**
- After analysis supports a buy/sell/short decision
- To set limit orders at target prices
- To attach stop-loss orders for risk management

**Parameters:**
- symbol (required): Stock ticker, e.g., "AAPL"
- side (required): "buy" or "sell"
- qty (required): Number of shares
- type (optional): "market" (default), "limit", "stop", "stop_limit"
- limit_price (optional): Limit price for limit orders
- stop_price (optional): Stop price for stop orders
- time_in_force (optional): "day", "gtc" (good till cancel), "ioc"
- take_profit_pct (optional): Auto-sell at this % above entry (e.g., 15 for 15%)
- stop_loss_pct (optional): Auto-sell at this % below entry (e.g., 5 for 5%)

**Rules:**
- ALWAYS check positions first if not specified
- Calculate position size using Kelly Criterion or fixed % (default: 5% of portfolio)
- NEVER exceed max position size (see risk_limits)
- ALWAYS attach stop-loss for new buy orders
- If auto-trade is disabled, return the order as a recommendation for approval

**Examples:**
- Market buy 10 shares AAPL with 5% stop-loss: symbol="AAPL", side="buy", qty="10", stop_loss_pct="5"
- Limit buy at $150: symbol="AAPL", side="buy", qty="10", type="limit", limit_price="150"
- Sell half position: symbol="AAPL", side="sell", qty="5" (specify qty, not percentage)`;

export const CANCEL_ORDER_DESCRIPTION = `### cancel_order

Cancel a pending order by its order ID.

**When to use:**
- User wants to cancel a pending limit/stop order
- Market conditions changed and order is no longer relevant
- To prevent unwanted execution

**Parameters:**
- order_id (required): The Alpaca order ID (found from get_orders)

**Note:** Only pending (new/partially_filled) orders can be cancelled.
Cancelled orders cannot be reinstated.`;

export const GET_ORDERS_DESCRIPTION = `### get_orders

Get all orders, optionally filtered by status.

**When to use:**
- Check status of pending or recent orders
- Review filled/cancelled orders for trade history
- Before placing new orders to avoid conflicts

**Parameters:**
- status (optional): "open", "closed", "all" (default: "open")
- limit (optional): Max number of orders to return (default: 50)

**Returns:** List of orders with ID, symbol, side, type, qty, filled_qty, price, status, created_at.

**Common statuses:**
- new: Submitted, not yet processed
- partially_filled: Some shares executed
- filled: Fully executed
- cancelled: User cancelled
- expired: Time-in-force expired (e.g., day order not filled)`;

export const CLOSE_POSITION_DESCRIPTION = `### close_position

Close (liquidate) an entire position by symbol.

**When to use:**
- Stop-loss triggered (use the stop-loss price, not this tool)
- Take-profit target reached
- Position no longer meets investment thesis
- Risk management: reduce exposure

**Parameters:**
- symbol (required): Stock ticker to close
- qty (optional): Specific number of shares (omit = close entire position)

**Warning:** Closing all positions is equivalent to going to 100% cash.
This is a valid defensive action if your analysis supports it.`;

export const GET_PORTFOLIO_HISTORY_DESCRIPTION = `### get_portfolio_history

Get portfolio value history for performance analysis.

**When to use:**
- When asked about historical performance
- To calculate returns over specific periods
- For drawdown analysis

**Parameters:**
- period (optional): "1D", "1W", "1M", "3M", "1A", "all" (default: "1M")
- timeframe (optional): "1Min", "5Min", "15Min", "1H", "1D" (default: "1D")

**Returns:**
- Equity curve data
- Daily/total returns
- Max drawdown`;

export const GET_TRADING_CONFIG_DESCRIPTION = `### get_trading_config

View current trading configuration and risk settings.

**When to use:**
- "What are my trading settings?"
- Before modifying risk parameters
- Check if auto-trade is enabled

**Returns:**
- Trading mode (paper/live)
- Auto-trade status
- Risk limits (position size, stop-loss, etc.)
- Alarms and alerts configuration`;

export const UPDATE_TRADING_CONFIG_DESCRIPTION = `### update_trading_config

Update trading configuration and risk settings.

**When to use:**
- User wants to change risk parameters
- Toggle auto-trade on/off
- Adjust position size limits

**Parameters:**
- auto_trade (optional): "true" or "false"
- max_position_size (optional): Max % per position (e.g., "0.05" for 5%)
- max_daily_loss (optional): Daily loss threshold (e.g., "0.02" for 2%)
- max_portfolio_loss (optional): Portfolio loss threshold (e.g., "0.10" for 10%)
- default_stop_loss_pct (optional): Default stop-loss %

**IMPORTANT:** When enabling auto-trade, remind the user:
- Paper trading is recommended until strategy is validated
- Past performance does not guarantee future results
- Max position size of 5% is recommended for most strategies`;

export const CALCULATE_POSITION_DESCRIPTION = `### calculate_position

Calculate the optimal position size based on risk parameters.

**When to use:**
- Before placing any buy order
- When the user wants to understand position sizing logic
- To backtest different position sizes

**Parameters:**
- symbol (required): Stock ticker
- entry_price (optional): Expected entry price (fetched if not provided)
- stop_loss_pct (optional): Stop-loss % (uses default if not provided)
- target_allocation (optional): Target % of portfolio (default: max_position_size)

**Returns:**
- Recommended shares to buy
- Dollar amount
- Risk per trade (max loss if stop-loss triggered)
- Portfolio exposure after trade
- Risk/reward ratio`;
