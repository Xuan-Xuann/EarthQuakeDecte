const WebSocket = require('ws');  // ✅ 确保正确导入
const http = require('http');
const moment = require('moment');
const winston = require('winston');
const express = require('express');
const fs = require('fs');
const path = require('path');

// 引入新的地震算法库
const {
  calculateMagnitude,
  calculateIntensity,
  calculateJmaSeismicIntensity,
  classifyEarthquake,
  assessAlertLevel,
  detectEarthquake,
  calculateEnergy,
  calculateImpactRadius
} = require('../earthquake-algorithm');

// 配置日志
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// 创建 Express 应用和 HTTP 服务器
const app = express();
const server = http.createServer(app);

// ✅ 这是关键修复！使用 WebSocket.Server 而不是 Server
const wss = new WebSocket.Server({ server });

// 存储连接的客户端
const clients = new Map();
// 存储设备数据
const deviceData = new Map();
// 存储最近的数据用于实时显示
const recentData = [];

// 数据缓存配置
const CACHE_DIR = path.join(__dirname, 'cache');
const DATA_CACHE_FILE = path.join(CACHE_DIR, 'sensor-data-cache.json');
const MAX_CACHE_SIZE = 1000; // 最大缓存数据条数

// 确保缓存目录存在
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// 初始化数据缓存
let dataCache = [];

// 尝试从文件加载缓存数据
try {
  if (fs.existsSync(DATA_CACHE_FILE)) {
    const cacheData = fs.readFileSync(DATA_CACHE_FILE, 'utf8');
    dataCache = JSON.parse(cacheData);
    logger.info(`从缓存文件加载了 ${dataCache.length} 条历史数据`);
  }
} catch (error) {
  logger.error(`加载缓存数据失败: ${error.message}`);
}

// 心跳检测间隔（秒）
const HEARTBEAT_INTERVAL = 30000; // 30秒

// 数据包统计
let packetCount = 0;  // 当前秒内的数据包计数
let lastPacketReset = Date.now();  // 上次重置时间
let currentPps = 0;  // 当前PPS值

// 定义最大历史数据大小常量
const MAX_HISTORY_SIZE = 100;
const MAX_RECENT_DATA_SIZE = 100;

// 为静态内容提供服务
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>地震检测平台</title>
        <meta charset="utf-8">
        <style>
            body { 
                font-family: Arial, sans-serif; 
                margin: 40px;
                background-color: #f5f5f5;
            }
            .container {
                max-width: 800px;
                margin: 0 auto;
                background: white;
                padding: 30px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 {
                color: #2c3e50;
                text-align: center;
            }
            .stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin: 30px 0;
            }
            .stat-card {
                background: #ecf0f1;
                padding: 20px;
                border-radius: 6px;
                text-align: center;
            }
            .stat-value {
                font-size: 2em;
                font-weight: bold;
                color: #3498db;
            }
            .stat-label {
                color: #7f8c8d;
                margin-top: 5px;
            }
            .api-endpoints {
                margin-top: 30px;
            }
            .endpoint {
                background: #f8f9fa;
                padding: 15px;
                margin: 10px 0;
                border-radius: 4px;
                border-left: 4px solid #3498db;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🌍 地震检测平台</h1>
            <p>这是一个用于检测地震活动的实时监控平台，接收来自ESP32传感器的数据。</p>
            
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-value">${clients.size}</div>
                    <div class="stat-label">活动连接</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${deviceData.size}</div>
                    <div class="stat-label">注册设备</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${recentData.length}</div>
                    <div class="stat-label">最近数据</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${process.uptime().toFixed(0)}</div>
                    <div class="stat-label">运行时间(秒)</div>
                </div>
            </div>
            
            <div class="api-endpoints">
                <h2>API 端点</h2>
                <div class="endpoint">
                    <strong>GET /health</strong> - 服务器健康状态
                </div>
                <div class="endpoint">
                    <strong>GET /api/devices</strong> - 获取所有设备信息
                </div>
                <div class="endpoint">
                    <strong>GET /api/device/:id/data</strong> - 获取特定设备数据
                </div>
                <div class="endpoint">
                    <strong>GET /api/recent-data</strong> - 获取最近数据
                </div>
                <div class="endpoint">
                    <strong>POST /api/test/earthquake</strong> - 测试地震警报
                </div>
            </div>
            
            <p><em>WebSocket 服务器运行在 ws://localhost:8080</em></p>
        </div>
    </body>
    </html>
  `);
});

// WebSocket 连接处理
wss.on('connection', (ws, req) => {
  const clientId = generateClientId(req);
  const clientIp = req.socket.remoteAddress;
  
  logger.info(`新的连接: ${clientId} 来自 IP: ${clientIp}`);
  
  // 存储客户端信息
  clients.set(ws, {
    id: clientId,
    ip: clientIp,
    connectedAt: new Date(),
    lastHeartbeat: Date.now(),
    deviceId: null,
    clientType: 'unknown' // 新增字段，标识客户端类型
  });
  
  // 发送欢迎消息
  ws.send(JSON.stringify({
    type: 'connection_established',
    server_time: new Date().toISOString(),
    client_id: clientId,
    message: 'WebSocket 连接已建立'
  }));
  
  // 客户端发送ping响应（pong）的处理
  ws.on('pong', () => {
    const client = clients.get(ws);
    if (client) {
      client.lastHeartbeat = Date.now();
    }
  });
  
  // 定期ping客户端
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(heartbeatInterval);
      const client = clients.get(ws);
      if (client) {
        clients.delete(ws);
      }
    }
  }, HEARTBEAT_INTERVAL);

  // 消息处理
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(ws, data);
    } catch (error) {
      logger.error(`消息解析错误 (${clientId}): ${error.message}`);
      ws.send(JSON.stringify({
        type: 'error',
        message: '无效的JSON格式'
      }));
    }
  });
  
  // 连接关闭处理
  ws.on('close', () => {
    clearInterval(heartbeatInterval); // 清除心跳定时器
    
    const client = clients.get(ws);
    if (client) {
      logger.info(`连接关闭: ${client.id} (设备: ${client.deviceId || '未注册'})`);
      
      // 如果设备已注册，更新其状态
      if (client.deviceId) {
        const deviceInfo = deviceData.get(client.deviceId);
        if (deviceInfo) {
          deviceInfo.status = 'disconnected';
          deviceInfo.lastSeen = new Date();
        }
      }
      
      clients.delete(ws);
      
      // 广播设备离线状态
      broadcastToDashboards({
        type: 'device_status',
        device_id: client.deviceId,
        status: 'disconnected',
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // 错误处理
  ws.on('error', (error) => {
    logger.error(`WebSocket 错误 (${clientId}): ${error.message}`);
  });
});

// 处理接收到的消息
function handleMessage(ws, data) {
  const client = clients.get(ws);
  
  if (!data.type) {
    logger.warn(`收到无类型消息来自 ${client.id}`);
    return;
  }
  
  switch (data.type) {
    case 'sensor_data':
      handleSensorData(ws, data, client);
      break;
      
    case 'device_register':
      handleDeviceRegister(ws, data, client);
      break;
      
    case 'heartbeat':
      handleHeartbeat(ws, data, client);
      break;
      
    case 'status_update':
      handleStatusUpdate(ws, data, client);
      break;
      
    case 'client_register':  // 新增：客户端注册消息类型
      handleClientRegister(ws, data, client);
      break;
      
    default:
      logger.warn(`未知消息类型: ${data.type} 来自 ${client.id}`);
  }
}

// 新增：处理客户端注册
function handleClientRegister(ws, data, client) {
  const { client_type = 'generic' } = data;
  
  // 更新客户端类型
  client.clientType = client_type;
  
  // 发送确认响应
  ws.send(JSON.stringify({
    type: 'client_registered',
    client_type,
    server_time: new Date().toISOString(),
    message: '客户端注册成功'
  }));
  
  // 如果是监控客户端，发送当前所有数据
  if (client_type === 'monitor') {
    // 发送服务器健康状态
    ws.send(JSON.stringify({
      type: 'server_health',
      ...getHealthStatus()
    }));
    
    // 发送设备数据
    ws.send(JSON.stringify({
      type: 'devices_data',
      devices: Array.from(deviceData.entries()).map(([id, info]) => {
        // 为每个设备添加最后数据
        const lastHistoryEntry = info.history.length > 0 ? info.history[info.history.length - 1] : null;
        return {
          device_id: id,
          lastData: lastHistoryEntry,
          ...info
        };
      })
    }));
    
    // 发送最近数据
    ws.send(JSON.stringify({
      type: 'recent_data',
      recent_data: recentData
    }));
  }
}

// 获取服务器健康状态
function getHealthStatus() {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    connections: clients.size,
    devices: deviceData.size,
    uptime: process.uptime()
  };
}

// 处理传感器数据
function handleSensorData(ws, data, client) {
  const { device_id, timestamp, ax, ay, az, gx, gy, gz } = data;
  
  // 验证数据
  if (!device_id || !timestamp) {
    logger.warn(`无效的传感器数据来自 ${client.id}`);
    return;
  }
  
  // 确保设备已注册
  if (!deviceData.has(device_id)) {
    logger.warn(`未注册设备尝试发送数据: ${device_id}`);
    return;
  }
  
  // 解析传感器值
  const parsedData = {
    ax: parseFloat(ax),
    ay: parseFloat(ay),
    az: parseFloat(az),
    gx: parseFloat(gx),
    gy: parseFloat(gy),
    gz: parseFloat(gz)
  };
  
  // 验证传感器值
  for (const [key, value] of Object.entries(parsedData)) {
    if (isNaN(value)) {
      logger.warn(`传感器数据中包含无效值 ${key}: ${data[key]}`);
      return;
    }
  }
  
  // 更新设备最后活动时间
  const deviceInfo = deviceData.get(device_id);
  deviceInfo.lastSeen = new Date();
  
  // 使用新的地震算法
  const magnitude = calculateMagnitude(parsedData.ax, parsedData.ay, parsedData.az);
  const intensity = calculateIntensity(parsedData.ax, parsedData.ay, parsedData.az, 10); // 传入距离参数
  const jmaResult = calculateJmaSeismicIntensity(parsedData.ax, parsedData.ay, parsedData.az);
  const jmaIntensity = jmaResult.intensity;
  const pga = jmaResult.pga_raw;
  const earthquakeType = classifyEarthquake(magnitude);
  const alertObj = assessAlertLevel(magnitude, intensity);
  const alertLevel = alertObj.level;
  const energy = calculateEnergy(magnitude);
  const impactRadius = calculateImpactRadius(magnitude);
  
  // 检测是否为地震
  const isEarthquake = detectEarthquake(magnitude);
  
  // 创建增强的传感器数据对象
  const enhancedData = {
    ...data,
    server_timestamp: new Date().toISOString(),
    magnitude: parseFloat(magnitude.toFixed(4)),
    intensity: parseFloat(intensity.toFixed(4)),
    jma_intensity: parseFloat(jmaIntensity.toFixed(4)),
    pga: parseFloat(pga.toFixed(6)),
    earthquake_type: earthquakeType,
    alert_level: alertLevel,
    energy: energy,
    impact_radius: impactRadius,
    is_earthquake: isEarthquake,
    location: deviceInfo.location || null
  };
  
  // 添加到设备历史数据
  deviceInfo.history.push(enhancedData);
  if (deviceInfo.history.length > MAX_HISTORY_SIZE) {
    deviceInfo.history.shift();
  }
  
  // 添加到最近数据列表
  recentData.push(enhancedData);
  if (recentData.length > MAX_RECENT_DATA_SIZE) {
    recentData.shift();
  }
  
  // 添加到数据缓存
  dataCache.push(enhancedData);
  if (dataCache.length > MAX_CACHE_SIZE) {
    dataCache.shift();
  }
  
  // 定期保存缓存到文件（每100条数据或检测到地震时）
  if (dataCache.length % 100 === 0 || isEarthquake) {
    try {
      fs.writeFileSync(DATA_CACHE_FILE, JSON.stringify(dataCache, null, 2));
    } catch (error) {
      logger.error(`保存缓存数据失败: ${error.message}`);
    }
  }
  
  // 统计数据包数量
  packetCount++;
  const now = Date.now();
  if (now - lastPacketReset >= 1000) {  // 每秒重置一次
    currentPps = packetCount;  // 记录当前PPS值
    packetCount = 0;  // 重置计数器
    lastPacketReset = now;  // 更新重置时间
  }
  
  logger.info(`传感器数据 - 设备: ${device_id}, 震级: ${magnitude.toFixed(2)}, ` +
              `烈度: ${intensity.toFixed(2)}, 震度: ${jmaIntensity.toFixed(2)}, ` +
              `类型: ${earthquakeType}, 警报: ${alertLevel}, ` +
              `地震: ${isEarthquake ? '是' : '否'}`);
  
  // 响应客户端
  if (ws) {
    ws.send(JSON.stringify({
      type: 'data_received',
      timestamp: new Date().toISOString(),
      magnitude: magnitude,
      is_earthquake: isEarthquake
    }));
  }
  
  // 广播数据到监控面板
  broadcastToDashboards(enhancedData);
  
  // 如果检测到地震，触发警报
  if (isEarthquake) {
    handleEarthquakeAlert(enhancedData);
  }
}

// 处理设备注册
function handleDeviceRegister(ws, data, client) {
  const { device_id, location } = data; // 移除设备类型字段
  
  if (!device_id) {
    ws.send(JSON.stringify({
      type: 'error',
      message: '设备ID不能为空'
    }));
    return;
  }
  
  // 更新客户端信息
  client.deviceId = device_id;
  
  // 存储设备信息
  if (!deviceData.has(device_id)) {
    deviceData.set(device_id, {
      location,
      status: 'connected',
      connectedAt: new Date(),
      lastSeen: new Date(),
      history: []
    });
  } else {
    const deviceInfo = deviceData.get(device_id);
    deviceInfo.status = 'connected';
    deviceInfo.lastSeen = new Date();
  }
  
  logger.info(`设备注册: ${device_id}`); // 简化日志信息
  
  // 发送注册成功响应
  ws.send(JSON.stringify({
    type: 'device_registered',
    device_id,
    server_time: new Date().toISOString(),
    message: '设备注册成功'
  }));
  
  // 广播设备状态
  broadcastToDashboards({
    type: 'device_status',
    device_id,
    location,
    status: 'connected',
    timestamp: new Date().toISOString()
  });
}

// 处理心跳
function handleHeartbeat(ws, data, client) {
  const { device_id } = data;
  
  if (client) {
    client.lastHeartbeat = Date.now();
    
    if (device_id && deviceData.has(device_id)) {
      const deviceInfo = deviceData.get(device_id);
      deviceInfo.status = 'connected'; // 更新状态为连接
      deviceInfo.lastSeen = new Date(); // 更新最后活动时间
    }
    
    // 响应心跳
    ws.send(JSON.stringify({
      type: 'heartbeat_ack',
      timestamp: new Date().toISOString()
    }));
  }
}

// 处理状态更新
function handleStatusUpdate(ws, data, client) {
  const { device_id, battery, signal_strength, free_heap } = data;
  
  if (device_id && deviceData.has(device_id)) {
    const deviceInfo = deviceData.get(device_id);
    deviceInfo.battery = battery;
    deviceInfo.signal_strength = signal_strength;
    deviceInfo.free_heap = free_heap;
    deviceInfo.status = 'connected'; // 更新状态为连接
    deviceInfo.lastSeen = new Date();
    
    // 广播状态更新
    broadcastToDashboards({
      type: 'device_status_update',
      device_id,
      battery,
      signal_strength,
      free_heap,
      timestamp: new Date().toISOString()
    });
  }
}

// 处理地震警报
function handleEarthquakeAlert(data) {
  const alertMessage = {
    type: 'earthquake_alert',
    alert_level: 'warning',
    device_id: data.device_id,
    magnitude: data.magnitude,
    timestamp: data.server_timestamp,
    location: data.location || '未知位置',
    message: `检测到地震活动！震级: ${data.magnitude}`
  };
  
  logger.warn(`地震警报: ${JSON.stringify(alertMessage)}`);
  
  // 广播警报到所有连接（包括ESP32）
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(alertMessage));
    }
  });
}


// 广播消息到监控面板
function broadcastToDashboards(message) {
  wss.clients.forEach(client => {
    const clientInfo = clients.get(client);
    if (client.readyState === WebSocket.OPEN && 
        clientInfo && 
        (clientInfo.deviceId === 'DASHBOARD' || clientInfo.clientType === 'monitor')) {
      client.send(JSON.stringify(message));
    }
  });
}

// 生成客户端ID
function generateClientId(req) {
  const ip = req.socket.remoteAddress;
  const port = req.socket.remotePort;
  const timestamp = Date.now();
  return `client_${ip.replace(/[.:]/g, '_')}_${port}_${timestamp}`;
}

// 定期心跳检查
setInterval(() => {
  const now = Date.now();
  wss.clients.forEach(client => {
    const clientInfo = clients.get(client);
    if (clientInfo && now - clientInfo.lastHeartbeat > HEARTBEAT_INTERVAL * 2) {
      logger.warn(`心跳超时，关闭连接: ${clientInfo.id}`);
      client.terminate();
      clients.delete(client);
      
      // 如果是设备连接，更新其状态
      if (clientInfo.deviceId) {
        const deviceInfo = deviceData.get(clientInfo.deviceId);
        if (deviceInfo) {
          deviceInfo.status = 'disconnected';
          deviceInfo.lastSeen = new Date();
          
          // 广播设备离线状态
          broadcastToDashboards({
            type: 'device_status',
            device_id: clientInfo.deviceId,
            status: 'disconnected',
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  });
}, HEARTBEAT_INTERVAL);

// Express API 端点
app.use(express.json());

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    connections: clients.size,
    devices: deviceData.size,
    uptime: process.uptime(),
    pps: currentPps  // 添加PPS统计
  });
});

// 获取设备列表
app.get('/api/devices', (req, res) => {
  const devices = Array.from(deviceData.entries()).map(([id, info]) => ({
    device_id: id,
    ...info
  }));
  res.json({ devices });
});

// 获取设备数据
app.get('/api/device/:id/data', (req, res) => {
  const deviceId = req.params.id;
  const limit = parseInt(req.query.limit) || 100;
  
  if (deviceData.has(deviceId)) {
    const deviceInfo = deviceData.get(deviceId);
    const data = deviceInfo.history.slice(-limit);
    res.json({ device_id: deviceId, data });
  } else {
    res.status(404).json({ error: '设备未找到' });
  }
});

// 获取最近数据
app.get('/api/recent-data', (req, res) => {
  res.json({ recent_data: recentData });
});

// 获取缓存的历史数据（用于图表显示）
app.get('/api/history-data', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const from = req.query.from; // 开始时间戳
  const to = req.query.to; // 结束时间戳
  
  let filteredData = [...dataCache];
  
  // 根据时间范围过滤数据
  if (from) {
    filteredData = filteredData.filter(item => item.timestamp >= from);
  }
  if (to) {
    filteredData = filteredData.filter(item => item.timestamp <= to);
  }
  
  // 限制返回数据量
  const limitedData = filteredData.slice(-limit);
  
  res.json({ 
    history_data: limitedData,
    total_count: filteredData.length,
    returned_count: limitedData.length
  });
});

// 清除数据缓存
app.post('/api/clear-cache', (req, res) => {
  const backupPath = path.join(CACHE_DIR, `sensor-data-cache-backup-${Date.now()}.json`);
  
  try {
    // 备份当前缓存
    fs.writeFileSync(backupPath, JSON.stringify(dataCache, null, 2));
    // 清空内存中的缓存
    dataCache = [];
    // 删除缓存文件
    if (fs.existsSync(DATA_CACHE_FILE)) {
      fs.unlinkSync(DATA_CACHE_FILE);
    }
    
    logger.info(`数据缓存已清除，备份到: ${backupPath}`);
    
    res.json({
      message: '数据缓存已清除',
      backup: path.basename(backupPath)
    });
  } catch (error) {
    logger.error(`清除缓存失败: ${error.message}`);
    res.status(500).json({ error: '清除缓存失败' });
  }
});

// 手动触发地震测试
app.post('/api/test/earthquake', (req, res) => {
  const { magnitude = 4.5, device_id = 'test_device' } = req.body;
  
  const testData = {
    type: 'sensor_data',
    device_id,
    timestamp: new Date().toISOString(),
    ax: magnitude * 0.1,
    ay: magnitude * 0.2,
    az: magnitude * 0.3,
    gx: 0,
    gy: 0,
    gz: 0
  };
  
  handleSensorData(null, testData, { id: 'test_api' });
  
  res.json({
    message: '地震测试已触发',
    magnitude,
    timestamp: testData.timestamp
  });
});

// 启动服务器
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  logger.info(`地震检测平台服务器启动`);
  logger.info(`WebSocket 服务器监听端口: ${PORT}`);
  logger.info(`HTTP API 地址: http://localhost:${PORT}`);
  logger.info(`健康检查: http://localhost:${PORT}/health`);
});

// 优雅关闭
process.on('SIGINT', () => {
  logger.info('正在关闭服务器...');
  
  // 通知所有客户端
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'server_shutdown',
        message: '服务器正在关闭',
        timestamp: new Date().toISOString()
      }));
      client.close();
    }
  });
  
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
});

module.exports = { wss, server, deviceData };