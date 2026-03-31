/**
 * Trading Tools Module - Dexter Autonomous Trading System
 *
 * Provides tools for:
 * - Account & portfolio status
 * - Position management (view, close)
 * - Order execution (market, limit, stop-loss)
 * - Risk management & position sizing
 *
 * Integration: Alpaca Trade API (paper or live)
 * See env.example for configuration
 */

export {
  createGetAccount,
  GET_ACCOUNT_DESCRIPTION,
  createGetPositions,
  GET_POSITIONS_DESCRIPTION,
  createPlaceOrder,
  PLACE_ORDER_DESCRIPTION,
  createCancelOrder,
  CANCEL_ORDER_DESCRIPTION,
  createGetOrders,
  GET_ORDERS_DESCRIPTION,
  createClosePosition,
  CLOSE_POSITION_DESCRIPTION,
  createGetPortfolioHistory,
  GET_PORTFOLIO_HISTORY_DESCRIPTION,
  createGetTradingConfig,
  GET_TRADING_CONFIG_DESCRIPTION,
  createUpdateTradingConfig,
  UPDATE_TRADING_CONFIG_DESCRIPTION,
} from './trading-tools.js';

export {
  TRADING_TOOL_DESCRIPTION,
  TRADING_MODE_DESCRIPTION,
  RISK_LIMITS_DESCRIPTION,
} from './descriptions.js';
