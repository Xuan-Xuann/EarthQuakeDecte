const { spawn } = require('child_process');
const readline = require('readline');

console.log('🚀 启动地震检测平台完整系统');
console.log('==============================\n');

// 启动 WebSocket 服务器
console.log('1. 启动 WebSocket 服务器...');
const server = spawn('node', ['websocket-server.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: false
});

// 监控服务器输出
server.stdout.on('data', (data) => {
  console.log(`[服务器] ${data.toString().trim()}`);
  
  // 当服务器完全启动后，启动监控仪表板
  if (data.toString().includes('WebSocket 服务器监听端口')) {
    setTimeout(() => {
      console.log('\n2. 启动监控仪表板...');
      startDashboard();
    }, 2000);
  }
});

server.stderr.on('data', (data) => {
  console.error(`[服务器错误] ${data.toString().trim()}`);
});

server.on('error', (err) => {
  console.error('启动服务器失败:', err.message);
  process.exit(1);
});

// 启动监控仪表板
function startDashboard() {
  const dashboard = spawn('node', ['monitor-dashboard.js'], {
    stdio: 'inherit',
    detached: false
  });
  
  dashboard.on('error', (err) => {
    console.error('启动监控仪表板失败:', err.message);
  });
  
  dashboard.on('exit', (code) => {
    console.log(`监控仪表板退出，代码: ${code}`);
    console.log('正在关闭服务器...');
    server.kill('SIGTERM');
    process.exit(0);
  });
  
  // 创建交互式命令行界面
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  console.log('\n📋 可用命令:');
  console.log('  help     - 显示帮助');
  console.log('  status   - 查看系统状态');
  console.log('  restart  - 重启监控仪表板');
  console.log('  quit     - 退出系统\n');
  
  rl.on('line', (input) => {
    const command = input.trim().toLowerCase();
    
    switch (command) {
      case 'help':
        console.log('\n可用命令:');
        console.log('  status   - 查看系统状态');
        console.log('  restart  - 重启监控仪表板');
        console.log('  test     - 发送测试数据');
        console.log('  quit     - 退出系统');
        break;
        
      case 'status':
        console.log('\n📊 系统状态:');
        console.log(`   服务器: ${server.exitCode === null ? '✅ 运行中' : '❌ 已停止'}`);
        console.log(`   仪表板: ${dashboard.exitCode === null ? '✅ 运行中' : '❌ 已停止'}`);
        console.log(`   时间: ${new Date().toLocaleTimeString()}`);
        break;
        
      case 'restart':
        console.log('重启监控仪表板...');
        dashboard.kill('SIGTERM');
        setTimeout(startDashboard, 1000);
        break;
        
      case 'quit':
        console.log('\n正在关闭系统...');
        dashboard.kill('SIGTERM');
        server.kill('SIGTERM');
        rl.close();
        process.exit(0);
        break;
        
      default:
        if (command) {
          console.log(`未知命令: ${command}，输入 help 查看可用命令`);
        }
    }
  });
}

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n收到中断信号，正在关闭系统...');
  server.kill('SIGTERM');
  process.exit(0);
});