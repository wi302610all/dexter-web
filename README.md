# Dexter Web - 智能投资助手在线版

基于 Dexter Agent 的 Web 版本，支持浏览器直接使用。

## 功能

- 💬 实时对话交互
- 📊 股票价格查询
- 💰 DCF 估值分析
- 📰 市场新闻搜索
- 💹 自动交易（纸交易模式）
- 🏦 账户和持仓管理
- 🔧 26个金融工具

## 本地开发

### 1. 安装依赖

```bash
cd dexter-web
npm run install:all
```

### 2. 配置环境变量

复制 `server/.env.example` 为 `server/.env`，填入你的 API Key：

```env
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key
ALPACA_API_KEY=your-alpaca-key
ALPACA_API_SECRET=your-alpaca-secret
```

### 3. 启动服务

```bash
npm run dev
```

访问 http://localhost:3001

## 部署

### Railway（推荐）

1. 访问 https://railway.app
2. 连接 GitHub 仓库
3. 设置环境变量
4. 自动部署

### Vercel

1. 访问 https://vercel.com
2. 导入项目
3. 配置构建命令：`npm run install:all && npm run build`
4. 部署

## 项目结构

```
dexter-web/
├── server/          # 后端服务
│   ├── src/
│   │   └── index.js # Express + WebSocket
│   ├── .env.example
│   └── package.json
├── client/          # 前端静态文件
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── package.json
```

## 技术栈

- **后端**: Express + WebSocket
- **前端**: 原生 JavaScript + CSS
- **AI**: OpenAI / Anthropic API
- **交易**: Alpaca Trade API

## 许可证

MIT
