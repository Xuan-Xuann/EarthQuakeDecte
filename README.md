# 由ESP32组成的微型地震监测系统

一个集成的地震检测系统，包含数据采集服务器和实时监控界面。

## 硬件选择

ESP32-WROOM + MPU6050 + 若干条线组成

开发环境：VSC中使用ESP-IDF来开发

## 项目结构

```
earthquake/
├── package.json              # 主配置文件，包含所有依赖和脚本
├── README.md                 # 项目说明
├── server/                   # 数据采集服务器
│   ├── websocket-server.js   # 主服务器代码
│   ├── test-client.js        # 测试客户端
│   ├── start-all.js          # 启动所有服务脚本
│   └── logs/                 # 日志目录
└── web-interface/            # 实时监控界面
    ├── server.js             # 前端服务器代码
    ├── public/               # 前端静态资源
    │   └── index.html        # 监控界面
    └── node_modules/         # 前端依赖
```

## 安装和运行

### 安装依赖

```bash
npm install
```

### 启动系统

有两种方式启动系统：（我是用1Panel来部署的）

#### 方式一：并行启动（推荐）

```bash
# 同时启动服务器和前端界面
npm start
```

#### 方式二：分别启动

```bash
# 在单独的终端窗口中启动数据采集服务器（端口 8080）
npm run start:server

# 在另一个终端窗口中启动前端监控界面（端口 9000）
npm run start:web
```

### 开发模式

```bash
# 开发模式，自动重启
npm run dev
```

## 访问地址

- **主服务器**: [http://localhost:8080](http://localhost:8080)
- **监控界面**: [http://localhost:9000](http://localhost:9000)

## 功能特性

### 主服务器（端口 8080）

- WebSocket 接收来自 ESP32 传感器的数据
- RESTful API 提供数据查询接口
- 自动心跳检测机制
- 设备注册和管理
- 数据存储和历史记录

### 监控界面（端口 9000）

- 实时数据显示
- 动态更新的统计信息
- 设备状态监控
- 地震警报高亮显示
- 连接状态指示器

## 最终效果

![](C:\Users\31378\AppData\Roaming\Typora\typora-user-images\image-20260111180210384.png)![image-20260111180322188](C:\Users\31378\AppData\Roaming\Typora\typora-user-images\image-20260111180322188.png)



## API 端点

- `GET /health` - 服务器健康状态
- `GET /api/devices` - 获取所有设备信息
- `GET /api/device/:id/data` - 获取特定设备数据
- `GET /api/recent-data` - 获取最近数据
- `POST /api/test/earthquake` - 测试地震警报

## 未来规划

- [ ] 实现数据储存功能