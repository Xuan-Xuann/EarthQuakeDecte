const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 连接到主地震检测服务器
let earthquakeWs = null;
let isConnectedToMainServer = false;
let connectionCheckInterval = null;

// 存储设备详细数据用于图表
const deviceChartData = {};

// 存储设备数据用于前端显示
const deviceData = new Map();

// 控制向客户端发送数据的频率
const lastSendTime = {};
const SEND_INTERVAL = 500; // 500ms最小发送间隔

function connectToMainServer() {
  console.log('正在连接到主地震检测服务器...');
  
  // 关闭现有连接（如果有）
  if (earthquakeWs) {
    earthquakeWs.close();
  }
  
  // 重新创建WebSocket连接，使用正确的后端服务器地址
  const BACKEND_SERVER_URL = 'ws://localhost:8080'; // 统一使用localhost进行开发
  
  earthquakeWs = new WebSocket(BACKEND_SERVER_URL);

  earthquakeWs.on('open', () => {
    console.log('已连接到主地震检测服务器');
    isConnectedToMainServer = true;
    
    // 注册为监控客户端
    earthquakeWs.send(JSON.stringify({
      type: 'client_register',
      client_type: 'monitor'
    }));
  });
  
  earthquakeWs.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      
      // 添加调试日志，查看接收的消息内容
      if (message.type === 'sensor_data') {
        console.log('前端界面服务器接收到传感器数据:', {
          device_id: message.device_id,
          magnitude: message.magnitude,
          intensity: message.intensity,
          jma_intensity: message.jma_intensity,
          pga: message.pga,
          earthquake_type: message.earthquake_type,
          alert_level: message.alert_level,
          timestamp: message.timestamp
        });
      }
      
      // 如果是传感器数据，处理详细数据
      if (message.type === 'sensor_data') {
        const deviceId = message.device_id;
        
        // 控制发送频率
        const now = Date.now();
        if (!lastSendTime[deviceId] || now - lastSendTime[deviceId] >= SEND_INTERVAL) {
          lastSendTime[deviceId] = now;
          
          // 存储详细数据用于图表
          if (!deviceChartData[deviceId]) {
            deviceChartData[deviceId] = {
              timestamps: [],
              ax: [], ay: [], az: [],
              gx: [], gy: [], gz: []
            };
          }
          
          // 保留最近100个数据点
          if (deviceChartData[deviceId].timestamps.length >= 100) {
            deviceChartData[deviceId].timestamps.shift();
            deviceChartData[deviceId].ax.shift();
            deviceChartData[deviceId].ay.shift();
            deviceChartData[deviceId].az.shift();
            deviceChartData[deviceId].gx.shift();
            deviceChartData[deviceId].gy.shift();
            deviceChartData[deviceId].gz.shift();
          }
          
          // 添加新数据
          deviceChartData[deviceId].timestamps.push(new Date(message.timestamp).getTime());
          deviceChartData[deviceId].ax.push(parseFloat(message.ax) || 0);
          deviceChartData[deviceId].ay.push(parseFloat(message.ay) || 0);
          deviceChartData[deviceId].az.push(parseFloat(message.az) || 0);
          deviceChartData[deviceId].gx.push(parseFloat(message.gx) || 0);
          deviceChartData[deviceId].gy.push(parseFloat(message.gy) || 0);
          deviceChartData[deviceId].gz.push(parseFloat(message.gz) || 0);
          
          // 发送详细数据给前端用于图表
          io.emit('detailed_sensor_data', {
            device_id: deviceId,
            timestamps: deviceChartData[deviceId].timestamps,
            ax: deviceChartData[deviceId].ax,
            ay: deviceChartData[deviceId].ay,
            az: deviceChartData[deviceId].az,
            gx: deviceChartData[deviceId].gx,
            gy: deviceChartData[deviceId].gy,
            gz: deviceChartData[deviceId].gz
          });
        }
      }
      
      // 如果是设备状态更新，我们需要存储最新的设备数据
      if (message.type === 'device_status' && message.device_id) {
        // 获取设备现有信息
        const deviceInfo = deviceData.get(message.device_id) || {};
        
        // 更新设备的最后数据
        deviceInfo.lastData = {
          magnitude: message.magnitude !== undefined ? message.magnitude : 0,
          intensity: message.intensity !== undefined ? message.intensity : 0,
          earthquake_type: message.earthquake_type !== undefined ? message.earthquake_type : 'N/A',
          jma_intensity: message.jma_intensity !== undefined ? message.jma_intensity : 'N/A',
          pga: message.pga !== undefined ? message.pga : 0,
          alert_level: message.alert_level !== undefined ? message.alert_level : 'Normal'
        };
        
        deviceData.set(message.device_id, deviceInfo);
        
        console.log('设备状态更新:', {
          device_id: message.device_id,
          lastData: deviceInfo.lastData
        });
      }
      
      // 如果是传感器数据更新，更新设备的最后数据
      if (message.type === 'sensor_data' && message.device_id) {
        const deviceInfo = deviceData.get(message.device_id) || {};
        
        // 检查是否已经包含地震参数，如果没有，则计算它们
        let processedData = message;
        if (message.ax !== undefined && 
            (message.magnitude === undefined || message.intensity === undefined || 
             message.jma_intensity === undefined || message.pga === undefined ||
             message.earthquake_type === undefined || message.alert_level === undefined)) {
              
          // 从地震算法库导入函数来计算地震参数
          const { 
            calculateMagnitude, 
            calculateIntensity, 
            calculateJmaSeismicIntensity, 
            classifyEarthquake, 
            assessAlertLevel 
          } = require('../earthquake-algorithm'); // 从项目根目录导入算法库
          
          // 计算地震参数
          const magnitude = calculateMagnitude(message.ax, message.ay, message.az);
          const intensity = calculateIntensity(message.ax, message.ay, message.az, 10);
          const jmaResult = calculateJmaSeismicIntensity(message.ax, message.ay, message.az);
          const jmaIntensity = jmaResult.intensity;
          const pga = jmaResult.pga_raw;
          const earthquakeType = classifyEarthquake(magnitude);
          const alertObj = assessAlertLevel(magnitude, intensity);
          const alertLevel = alertObj.level;
          
          // 创建增强的数据对象
          processedData = {
            ...message,
            magnitude: parseFloat(magnitude.toFixed(4)),
            intensity: parseFloat(intensity.toFixed(4)),
            jma_intensity: parseFloat(jmaIntensity.toFixed(4)),
            pga: parseFloat(pga.toFixed(6)),
            earthquake_type: earthquakeType,
            alert_level: alertLevel,
            is_earthquake: magnitude >= 3.0  // 使用默认阈值
          };
        }
        
        // 更新设备的最后数据，确保所有地震相关数据都被正确传递
        deviceInfo.lastData = {
          magnitude: processedData.magnitude !== undefined ? processedData.magnitude : 0,
          intensity: processedData.intensity !== undefined ? processedData.intensity : 0,
          earthquake_type: processedData.earthquake_type !== undefined ? processedData.earthquake_type : 'N/A',
          jma_intensity: processedData.jma_intensity !== undefined ? processedData.jma_intensity : 'N/A',
          pga: processedData.pga !== undefined ? processedData.pga : 0,
          alert_level: processedData.alert_level !== undefined ? processedData.alert_level : 'Normal'
        };
        
        deviceData.set(message.device_id, deviceInfo);
        
        console.log('传感器数据更新设备最后数据:', {
          device_id: message.device_id,
          lastData: deviceInfo.lastData
        });
      }
      
      // 将消息转发给所有前端客户端 - 确保完整转发所有数据
      io.emit(message.type, message);
    } catch (error) {
      console.error('解析主服务器消息失败:', error);
    }
  });
  
  earthquakeWs.on('close', () => {
    console.log('与主地震检测服务器断开连接');
    isConnectedToMainServer = false;
    
    // 尝试重连
    setTimeout(connectToMainServer, 5000);
  });
  
  earthquakeWs.on('error', (error) => {
    console.error('连接主地震检测服务器出错:', error);
    isConnectedToMainServer = false;
  });
}

// 开始连接
connectToMainServer();

// 定期检查与主服务器的连接状态
connectionCheckInterval = setInterval(() => {
  io.emit('connection_status', {
    type: 'connection_status',
    connected: isConnectedToMainServer,
    timestamp: new Date().toISOString(),
    backend_server: 'ws://localhost:8080'  // 统一使用localhost进行开发
  });
}, 5000);

// 每30秒向主服务器请求最新数据，确保数据同步
setInterval(() => {
  if (earthquakeWs && earthquakeWs.readyState === WebSocket.OPEN) {
    // 重新注册为监控客户端以获取最新数据
    earthquakeWs.send(JSON.stringify({
      type: 'client_register',
      client_type: 'monitor'
    }));
  }
}, 30000); // 每30秒同步一次

// Socket.io连接
io.on('connection', (socket) => {
  console.log('前端界面客户端连接:', socket.id);
  
  // 连接时立即发送连接状态
  socket.emit('connection_status', {
    type: 'connection_status',
    connected: isConnectedToMainServer,
    timestamp: new Date().toISOString(),
    backend_server: 'ws://localhost:8080'  // 统一使用localhost进行开发
  });
  
  // 连接时立即请求最新数据
  if (earthquakeWs && earthquakeWs.readyState === WebSocket.OPEN) {
    earthquakeWs.send(JSON.stringify({
      type: 'client_register',
      client_type: 'monitor'
    }));
  }
  
  // 发送所有设备的图表数据给新连接的客户端
  for (const deviceId in deviceChartData) {
    socket.emit('detailed_sensor_data', {
      device_id: deviceId,
      timestamps: deviceChartData[deviceId].timestamps,
      ax: deviceChartData[deviceId].ax,
      ay: deviceChartData[deviceId].ay,
      az: deviceChartData[deviceId].az,
      gx: deviceChartData[deviceId].gx,
      gy: deviceChartData[deviceId].gy,
      gz: deviceChartData[deviceId].gz
    });
  }
  
  socket.on('request_latest_data', () => {
    // 当客户端请求最新数据时，重新发送注册消息以获取最新数据
    if (earthquakeWs && earthquakeWs.readyState === WebSocket.OPEN) {
      earthquakeWs.send(JSON.stringify({
        type: 'client_register',
        client_type: 'monitor'
      }));
    }
  });
  
  socket.on('disconnect', () => {
    console.log('前端界面客户端断开:', socket.id);
  });
});

const PORT = 9000;
server.listen(PORT, () => {
  console.log(`前端界面服务器运行在端口 ${PORT}`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('正在关闭前端界面服务器...');
  
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
  }
  
  if (earthquakeWs) {
    earthquakeWs.close();
  }
  
  server.close(() => {
    console.log('前端界面服务器已关闭');
    process.exit(0);
  });
});

// 辅助函数：根据加速度计算粗略震级
function calculateMagnitudeFromAccel(ax, ay, az) {
  // 使用合成加速度计算
  const accel = Math.sqrt(ax * ax + ay * ay + az * az);
  // 使用简单的对数缩放来模拟震级计算
  const magnitude = Math.log10(Math.max(0.01, accel)) * 2;
  return isNaN(magnitude) ? 0 : magnitude;
}
