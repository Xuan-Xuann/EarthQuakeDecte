const WebSocket = require('ws');
const readline = require('readline');

class MonitorDashboard {
  constructor(serverUrl = 'ws://localhost:8080') {
    this.serverUrl = serverUrl;
    this.ws = null;
    this.devices = new Map();
    this.earthquakeAlerts = [];
    this.isConnected = false;
    
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    this.init();
  }
  
  init() {
    console.clear();
    console.log('🌍 地震检测平台 - 实时监控仪表板');
    console.log('=====================================\n');
    
    this.connectToServer();
    this.setupCommandInterface();
  }
  
  connectToServer() {
    console.log('正在连接到服务器...');
    
    this.ws = new WebSocket(this.serverUrl);
    
    this.ws.on('open', () => {
      console.log('✅ 已连接到WebSocket服务器\n');
      this.isConnected = true;
      
      // 注册为监控面板
      this.ws.send(JSON.stringify({
        type: 'device_register',
        device_id: 'DASHBOARD_CLI',
        device_type: 'MONITOR_DASHBOARD'
      }));
      
      this.displayStatus();
    });
    
    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });
    
    this.ws.on('close', () => {
      console.log('\n❌ 与服务器断开连接');
      this.isConnected = false;
      setTimeout(() => {
        console.log('尝试重新连接...');
        this.connectToServer();
      }, 5000);
    });
    
    this.ws.on('error', (error) => {
      console.error('连接错误:', error.message);
    });
  }
  
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'sensor_data':
          this.handleSensorData(message);
          break;
          
        case 'device_status':
          this.handleDeviceStatus(message);
          break;
          
        case 'earthquake_alert':
          this.handleEarthquakeAlert(message);
          break;
          
        case 'device_status_update':
          this.handleDeviceUpdate(message);
          break;
      }
    } catch (error) {
      console.error('消息解析错误:', error.message);
    }
  }
  
  handleSensorData(data) {
    const { device_id, magnitude, is_earthquake, timestamp } = data;
    
    if (!this.devices.has(device_id)) {
      this.devices.set(device_id, {
        lastMagnitude: magnitude,
        lastUpdate: new Date(timestamp),
        status: 'active',
        alertCount: 0
      });
    } else {
      const device = this.devices.get(device_id);
      device.lastMagnitude = magnitude;
      device.lastUpdate = new Date(timestamp);
      
      if (is_earthquake) {
        device.alertCount++;
      }
    }
    
    // 更新显示
    this.displayStatus();
  }
  
  handleDeviceStatus(data) {
    const { device_id, status } = data;
    
    if (this.devices.has(device_id)) {
      this.devices.get(device_id).status = status;
    } else {
      this.devices.set(device_id, {
        status,
        lastUpdate: new Date(),
        alertCount: 0
      });
    }
    
    this.displayStatus();
  }
  
  handleEarthquakeAlert(data) {
    const alert = {
      ...data,
      receivedAt: new Date()
    };
    
    this.earthquakeAlerts.unshift(alert);
    
    // 保持最近10个警报
    if (this.earthquakeAlerts.length > 10) {
      this.earthquakeAlerts.pop();
    }
    
    // 显示警报
    console.log('\n🚨🚨🚨 地震警报！🚨🚨🚨');
    console.log(`设备: ${data.device_id}`);
    console.log(`震级: ${data.magnitude}`);
    console.log(`时间: ${new Date(data.timestamp).toLocaleTimeString()}`);
    console.log(`位置: ${data.location || '未知'}`);
    console.log('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨\n');
    
    this.displayStatus();
  }
  
  handleDeviceUpdate(data) {
    const { device_id, battery, signal_strength } = data;
    
    if (this.devices.has(device_id)) {
      const device = this.devices.get(device_id);
      device.battery = battery;
      device.signal_strength = signal_strength;
      device.lastUpdate = new Date();
    }
  }
  
  displayStatus() {
    if (!this.isConnected) return;
    
    console.clear();
    console.log('🌍 地震检测平台 - 实时监控仪表板');
    console.log('=====================================\n');
    
    console.log(`📡 连接状态: ${this.isConnected ? '✅ 已连接' : '❌ 断开'}`);
    console.log(`🖥️  在线设备: ${this.devices.size} 台\n`);
    
    // 显示设备列表
    console.log('📋 设备状态:');
    console.log('------------------------------------------------');
    this.devices.forEach((device, id) => {
      const statusIcon = device.status === 'connected' ? '🟢' : '🔴';
      const timeAgo = Math.floor((new Date() - device.lastUpdate) / 1000);
      const batteryIcon = device.battery ? (device.battery > 50 ? '🔋' : '🪫') : '❓';
      
      console.log(`${statusIcon} ${id}`);
      console.log(`   震级: ${device.lastMagnitude || '--'} | 警报: ${device.alertCount || 0}次`);
      console.log(`   电量: ${device.battery ? device.battery.toFixed(0) + '%' + batteryIcon : '未知'}`);
      console.log(`   信号: ${device.signal_strength ? device.signal_strength.toFixed(0) + 'dBm' : '未知'}`);
      console.log(`   更新: ${timeAgo}秒前\n`);
    });
    
    // 显示最近警报
    if (this.earthquakeAlerts.length > 0) {
      console.log('🚨 最近警报:');
      console.log('------------------------------------------------');
      this.earthquakeAlerts.slice(0, 5).forEach((alert, index) => {
        const timeStr = new Date(alert.receivedAt).toLocaleTimeString();
        console.log(`${index + 1}. ${alert.device_id} - 震级 ${alert.magnitude} - ${timeStr}`);
      });
      console.log('');
    }
    
    console.log('命令: help - 显示帮助 | quit - 退出 | test - 模拟地震\n');
  }
  
  setupCommandInterface() {
    this.rl.on('line', (input) => {
      const command = input.trim().toLowerCase();
      
      switch (command) {
        case 'help':
          this.showHelp();
          break;
          
        case 'quit':
        case 'exit':
          this.cleanup();
          break;
          
        case 'test':
          this.simulateEarthquake();
          break;
          
        case 'clear':
          this.earthquakeAlerts = [];
          this.displayStatus();
          break;
          
        case 'devices':
          console.log('\n📱 设备详情:');
          this.devices.forEach((device, id) => {
            console.log(`\n${id}:`);
            console.log(JSON.stringify(device, null, 2));
          });
          break;
          
        default:
          if (command) {
            console.log(`未知命令: ${command}，输入 help 查看可用命令`);
          }
      }
    });
  }
  
  showHelp() {
    console.log('\n📖 可用命令:');
    console.log('  help     - 显示此帮助信息');
    console.log('  quit     - 退出程序');
    console.log('  test     - 模拟地震事件');
    console.log('  clear    - 清除警报历史');
    console.log('  devices  - 显示设备详情');
    console.log('');
  }
  
  simulateEarthquake() {
    if (this.ws && this.isConnected) {
      // 发送测试地震数据
      const testData = {
        type: 'sensor_data',
        device_id: 'TEST_DEVICE',
        timestamp: new Date().toISOString(),
        ax: 5.0,
        ay: 4.5,
        az: 5.5,
        gx: 0,
        gy: 0,
        gz: 0
      };
      
      this.ws.send(JSON.stringify(testData));
      console.log('✅ 已发送模拟地震数据');
    } else {
      console.log('❌ 未连接到服务器');
    }
  }
  
  cleanup() {
    console.log('\n正在关闭监控仪表板...');
    
    if (this.ws) {
      this.ws.close();
    }
    
    this.rl.close();
    process.exit(0);
  }
}

// 启动监控仪表板
const dashboard = new MonitorDashboard();