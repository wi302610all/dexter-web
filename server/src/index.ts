import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// 提供静态文件（前端）
app.use(express.static(join(__dirname, '../../client')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

// 存储会话
const sessions = new Map<string, { ws: WebSocket; history: Array<{role: string, content: string}> }>();

// 动态导入 Dexter Agent（延迟加载）
let AgentClass: any = null;

async function getAgent() {
  if (!AgentClass) {
    try {
      // 尝试导入 Dexter Agent
      const module = await import('./lib/agent/agent.js');
      AgentClass = module.Agent;
    } catch (error) {
      console.error('Failed to load Dexter Agent:', error);
      return null;
    }
  }
  return AgentClass;
}

// WebSocket 连接处理
wss.on('connection', (ws) => {
  const sessionId = Date.now().toString();
  sessions.set(sessionId, { ws, history: [] });
  
  ws.send(JSON.stringify({ type: 'connected', sessionId }));
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(ws, sessionId, message);
    } catch (error: any) {
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });
  
  ws.on('close', () => {
    sessions.delete(sessionId);
  });
});

// 处理消息
async function handleMessage(ws: WebSocket, sessionId: string, message: any) {
  const session = sessions.get(sessionId);
  if (!session) return;
  
  switch (message.type) {
    case 'chat':
      await processChat(ws, session, message.content);
      break;
    case 'clear':
      session.history = [];
      ws.send(JSON.stringify({ type: 'cleared' }));
      break;
  }
}

// 处理聊天
async function processChat(ws: WebSocket, session: any, userMessage: string) {
  // 添加用户消息到历史
  session.history.push({ role: 'user', content: userMessage });
  
  // 发送思考状态
  ws.send(JSON.stringify({
    type: 'thinking',
    message: '正在分析你的问题...'
  }));
  
  try {
    // 尝试使用真实 Agent
    const Agent = await getAgent();
    
    if (Agent) {
      // 使用真实 Dexter Agent
      const agent = await Agent.create({
        model: process.env.OPENAI_API_KEY ? 'gpt-4o' : 'claude-3-5-sonnet-20241022',
        memoryEnabled: false, // Web 版暂时禁用持久记忆
      });
      
      let finalAnswer = '';
      const toolCalls: any[] = [];
      
      // 运行 Agent 并处理事件流
      for await (const event of agent.run(userMessage)) {
        switch (event.type) {
          case 'thinking':
            ws.send(JSON.stringify({
              type: 'thinking',
              message: event.message
            }));
            break;
            
          case 'tool_call':
            ws.send(JSON.stringify({
              type: 'tool_call',
              tool: event.tool,
              args: event.args,
              status: 'running'
            }));
            toolCalls.push({ tool: event.tool, args: event.args });
            break;
            
          case 'tool_result':
            ws.send(JSON.stringify({
              type: 'tool_result',
              tool: event.tool,
              result: event.result
            }));
            break;
            
          case 'done':
            finalAnswer = event.answer;
            break;
        }
      }
      
      // 发送最终回答
      session.history.push({ role: 'assistant', content: finalAnswer });
      ws.send(JSON.stringify({
        type: 'done',
        message: finalAnswer
      }));
      
    } else {
      // 降级到模拟模式
      await processMockChat(ws, session, userMessage);
    }
    
  } catch (error: any) {
    console.error('Agent error:', error);
    
    // 错误时降级到模拟模式
    ws.send(JSON.stringify({
      type: 'error',
      message: `Agent 错误: ${error.message}。切换到模拟模式。`
    }));
    
    await processMockChat(ws, session, userMessage);
  }
}

// 模拟聊天（降级方案）
async function processMockChat(ws: WebSocket, session: any, userMessage: string) {
  const stockMatch = userMessage.match(/[A-Z]{1,5}/g);
  const needsPrice = /价格|股价|多少钱/.test(userMessage);
  const needsAnalysis = /分析|估值|DCF/.test(userMessage);
  const needsTrade = /买入|卖出|下单|交易/.test(userMessage);
  const needsAccount = /账户|持仓|余额/.test(userMessage);
  
  if (stockMatch && needsPrice) {
    const symbol = stockMatch[0];
    ws.send(JSON.stringify({
      type: 'tool_call',
      tool: 'get_stock_price',
      args: { symbol },
      status: 'running'
    }));
    
    await sleep(500);
    
    const mockPrice = (100 + Math.random() * 900).toFixed(2);
    ws.send(JSON.stringify({
      type: 'tool_result',
      tool: 'get_stock_price',
      result: `${symbol} 当前价格: $${mockPrice}\n涨跌幅: ${(Math.random() * 10 - 5).toFixed(2)}%`
    }));
  }
  
  if (needsAnalysis && stockMatch) {
    const symbol = stockMatch[0];
    ws.send(JSON.stringify({
      type: 'tool_call',
      tool: 'analyze_dcf',
      args: { symbol },
      status: 'running'
    }));
    
    await sleep(800);
    
    ws.send(JSON.stringify({
      type: 'tool_result',
      tool: 'analyze_dcf',
      result: `${symbol} DCF 分析结果:\n\n内在价值: $${(200 + Math.random() * 300).toFixed(2)}\n当前价格: $${(150 + Math.random() * 100).toFixed(2)}\n安全边际: ${(Math.random() * 30).toFixed(1)}%\n\n建议: 价格低于内在价值，具有一定安全边际。`
    }));
  }
  
  if (needsAccount) {
    ws.send(JSON.stringify({
      type: 'tool_call',
      tool: 'get_account',
      args: {},
      status: 'running'
    }));
    
    await sleep(300);
    
    ws.send(JSON.stringify({
      type: 'tool_result',
      tool: 'get_account',
      result: `账户状态:\n\n总资产: $${(50000 + Math.random() * 50000).toFixed(2)}\n现金: $${(10000 + Math.random() * 20000).toFixed(2)}\n持仓市值: $${(30000 + Math.random() * 30000).toFixed(2)}\n购买力: $${(15000 + Math.random() * 30000).toFixed(2)}`
    }));
    
    ws.send(JSON.stringify({
      type: 'tool_call',
      tool: 'get_positions',
      args: {},
      status: 'running'
    }));
    
    await sleep(400);
    
    ws.send(JSON.stringify({
      type: 'tool_result',
      tool: 'get_positions',
      result: `当前持仓:\n\nAAPL: 100股 | 成本 $150.00 | 现价 $178.50 | 盈亏 +18.9%\nNVDA: 50股 | 成本 $450.00 | 现价 $485.20 | 盈亏 +7.8%\nMSFT: 80股 | 成本 $380.00 | 现价 $415.00 | 盈亏 +9.2%`
    }));
  }
  
  if (needsTrade && stockMatch) {
    const symbol = stockMatch[0];
    const qtyMatch = userMessage.match(/(\d+)股/);
    const qty = qtyMatch ? parseInt(qtyMatch[1]) : 10;
    const side = /买入|buy/i.test(userMessage) ? 'buy' : 'sell';
    
    ws.send(JSON.stringify({
      type: 'tool_call',
      tool: 'place_order',
      args: { symbol, side, qty, type: 'market' },
      status: 'running'
    }));
    
    await sleep(600);
    
    ws.send(JSON.stringify({
      type: 'tool_result',
      tool: 'place_order',
      result: `订单已提交!\n\n订单ID: ORD-${Date.now()}\n${side === 'buy' ? '买入' : '卖出'}: ${symbol} x ${qty}股\n类型: 市价单\n状态: 已成交\n成交价: $${(100 + Math.random() * 200).toFixed(2)}`
    }));
  }
  
  await sleep(300);
  
  const response = generateResponse(userMessage, needsPrice, needsAnalysis, needsTrade, needsAccount);
  session.history.push({ role: 'assistant', content: response });
  
  ws.send(JSON.stringify({
    type: 'done',
    message: response
  }));
}

function generateResponse(query: string, hasPrice: boolean, hasAnalysis: boolean, hasTrade: boolean, hasAccount: boolean): string {
  if (hasAccount) {
    return '已查询你的账户信息和持仓情况。如需调整仓位或下单，请告诉我具体操作。';
  }
  if (hasTrade) {
    return '交易订单已执行。你可以在"我的账户"中查看最新持仓和盈亏情况。';
  }
  if (hasAnalysis) {
    return 'DCF 分析已完成。请结合市场环境和公司基本面综合判断投资决策。需要我提供更多数据吗？';
  }
  if (hasPrice) {
    return '股价信息已获取。需要进一步分析估值、财务数据或市场新闻吗？';
  }
  return '我是 Dexter，你的智能投资助手。我可以帮你：\n\n• 查询股票价格和财务数据\n• 进行 DCF 估值分析\n• 搜索市场新闻和内幕交易\n• 执行交易下单（纸交易模式）\n• 管理账户和持仓\n\n请告诉我你想了解哪只股票？';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// REST API endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/tools', (req, res) => {
  res.json([
    { name: 'get_stock_price', description: '获取股票实时价格' },
    { name: 'analyze_dcf', description: 'DCF 估值分析' },
    { name: 'get_financials', description: '获取财务报表' },
    { name: 'search_news', description: '搜索相关新闻' },
    { name: 'get_insider_trades', description: '内幕交易数据' },
    { name: 'place_order', description: '下单交易' },
    { name: 'get_account', description: '查看账户' },
    { name: 'get_positions', description: '查看持仓' },
  ]);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Dexter Web Server running on http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
});
