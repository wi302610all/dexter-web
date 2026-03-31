// WebSocket 连接
let ws = null;
let sessionId = null;

// DOM 元素
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const toolsList = document.getElementById('toolsList');
const connectionStatus = document.getElementById('connectionStatus');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  loadTools();
  autoResizeTextarea();
});

// 连接 WebSocket
function connectWebSocket() {
  // 使用当前页面的 host，支持本地和生产环境
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const wsUrl = `${protocol}//${host}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('WebSocket connected');
    updateConnectionStatus(true);
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleMessage(data);
  };
  
  ws.onclose = () => {
    console.log('WebSocket disconnected');
    updateConnectionStatus(false);
    // 重连
    setTimeout(connectWebSocket, 3000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

// 更新连接状态
function updateConnectionStatus(connected) {
  const statusDot = connectionStatus.querySelector('.status-dot');
  const statusText = connectionStatus.querySelector('span:last-child');
  
  if (connected) {
    statusDot.className = 'status-dot connected';
    statusText.textContent = '已连接';
  } else {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = '未连接';
  }
}

// 加载工具列表
async function loadTools() {
  try {
    const response = await fetch('/api/tools');
    const tools = await response.json();
    
    toolsList.innerHTML = tools.map(tool => `
      <div class="tool-item" onclick="selectTool('${tool.name}')">
        ${tool.description}
      </div>
    `).join('');
  } catch (error) {
    console.error('Failed to load tools:', error);
  }
}

// 选择工具
function selectTool(name) {
  const examples = {
    'get_stock_price': 'AAPL现在多少钱？',
    'analyze_dcf': '分析NVDA的DCF估值',
    'get_financials': '查看MSFT的财务报表',
    'search_news': '搜索TSLA的最新新闻',
    'get_insider_trades': '查看AAPL的内幕交易',
    'place_order': '买入100股AAPL',
    'get_account': '查看我的账户',
    'get_positions': '查看持仓'
  };
  
  const example = examples[name] || '';
  if (example) {
    messageInput.value = example;
    messageInput.focus();
  }
}

// 处理消息
function handleMessage(data) {
  switch (data.type) {
    case 'connected':
      sessionId = data.sessionId;
      break;
      
    case 'thinking':
      showThinking();
      break;
      
    case 'tool_call':
      showToolCall(data.tool, data.args, data.status);
      break;
      
    case 'tool_result':
      showToolResult(data.tool, data.result);
      break;
      
    case 'done':
      removeThinking();
      appendMessage('assistant', data.message);
      sendBtn.disabled = false;
      break;
      
    case 'error':
      removeThinking();
      appendMessage('assistant', `❌ 错误: ${data.message}`);
      sendBtn.disabled = false;
      break;
  }
}

// 显示思考中
function showThinking() {
  const thinking = document.createElement('div');
  thinking.className = 'message assistant thinking-message';
  thinking.innerHTML = `
    <div class="message-avatar">⬡</div>
    <div class="thinking-indicator">
      <div class="thinking-dot"></div>
      <div class="thinking-dot"></div>
      <div class="thinking-dot"></div>
    </div>
  `;
  messagesContainer.appendChild(thinking);
  scrollToBottom();
}

// 移除思考中
function removeThinking() {
  const thinking = document.querySelector('.thinking-message');
  if (thinking) thinking.remove();
}

// 显示工具调用
function showToolCall(tool, args, status) {
  removeThinking();
  
  const toolMessage = document.createElement('div');
  toolMessage.className = 'message assistant';
  toolMessage.innerHTML = `
    <div class="message-avatar">⬡</div>
    <div class="message-content">
      <div class="tool-call-card">
        <div class="tool-call-header">
          <span class="tool-call-icon">🔧</span>
          <span class="tool-call-name">${tool}</span>
          <span class="tool-call-status ${status}">${status === 'running' ? '执行中...' : '完成'}</span>
        </div>
        ${args && Object.keys(args).length > 0 ? `
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">
            ${Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(' | ')}
          </div>
        ` : ''}
      </div>
    </div>
  `;
  messagesContainer.appendChild(toolMessage);
  scrollToBottom();
}

// 显示工具结果
function showToolResult(tool, result) {
  const lastToolCard = messagesContainer.querySelector('.tool-call-card:last-child');
  if (lastToolCard) {
    const resultDiv = document.createElement('div');
    resultDiv.className = 'tool-call-result';
    resultDiv.textContent = result;
    lastToolCard.appendChild(resultDiv);
    
    // 更新状态为完成
    const statusSpan = lastToolCard.querySelector('.tool-call-status');
    if (statusSpan) {
      statusSpan.className = 'tool-call-status completed';
      statusSpan.textContent = '完成';
    }
  }
  scrollToBottom();
}

// 添加消息
function appendMessage(role, content) {
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.innerHTML = `
    <div class="message-avatar">${role === 'user' ? '👤' : '⬡'}</div>
    <div class="message-content">
      <div class="message-text">${content}</div>
    </div>
  `;
  messagesContainer.appendChild(message);
  scrollToBottom();
}

// 滚动到底部
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 发送消息
function sendMessage() {
  const message = messageInput.value.trim();
  if (!message || !ws || ws.readyState !== WebSocket.OPEN) return;
  
  // 显示用户消息
  appendMessage('user', message);
  
  // 发送到服务器
  ws.send(JSON.stringify({
    type: 'chat',
    content: message
  }));
  
  // 清空输入
  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;
}

// 快捷消息
function sendQuickMessage(text) {
  messageInput.value = text;
  sendMessage();
}

// 清空聊天
function clearChat() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'clear' }));
  }
  
  // 清空消息，保留欢迎消息
  messagesContainer.innerHTML = `
    <div class="message assistant">
      <div class="message-avatar">⬡</div>
      <div class="message-content">
        <div class="message-text">
          对话已清空。有什么我可以帮你的吗？
        </div>
      </div>
    </div>
  `;
}

// 键盘事件
function handleKeyDown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

// 自动调整文本框高度
function autoResizeTextarea() {
  messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
  });
}
