# 德州扑克计分 H5

基于 Cloudflare Pages + Durable Objects + WebSocket 的多人实时德州扑克计分应用。

## 功能

- **创建/加入房间** — 生成6位房间号，支持分享链接加入
- **Bet/Take** — 下注或从池子取分，所有操作实时同步
- **借分** — 向银行借分，以100为单位，记录借贷明细
- **Pot 显示** — 实时展示当前奖池金额
- **Rank 排行榜** — 按积分从低到高排序展示
- **活动日志** — 所有操作带时间戳实时展示
- **新轮次** — 一键分隔轮次
- **一键结算** — 展示原始积分、当前积分、借分、净赚

## 技术栈

- **前端**: 原生 HTML/CSS/JS + WebSocket
- **后端**: Cloudflare Workers + Durable Objects
- **部署**: Cloudflare Pages

## 本地开发

```bash
# 安装依赖
npm install

# 启动本地开发服务器
npm run dev
```

访问 http://localhost:3000

## 部署

```bash
npm run deploy
```

在 Cloudflare Pages 控制台中配置：
- Build command: 留空
- Build output directory: `public`
- 需要在 Cloudflare Dashboard 中绑定 Durable Object 命名空间（绑定名: `ROOM`，类名: `Room`）

## 项目结构

```
├── public/
│   ├── index.html      # 前端页面
│   └── _worker.js      # Worker 入口 + Room Durable Object
├── src/
│   └── worker.js       # Worker 源码（与 _worker.js 同步）
├── wrangler.toml       # Cloudflare 配置
└── package.json
```
