# Shalonghui Runway Backend

这是给自定义 GPT Action 使用的 Runway 中间层。它负责安全保存 Runway API Key，并向 GPT 暴露视频生成、图片生成和任务查询接口。

## 文件说明

- `server.js`: 后端服务代码
- `openapi.yaml`: 粘贴到 GPT Builder Actions 的 OpenAPI Schema
- `.env.example`: 环境变量模板
- `package.json`: 项目依赖和启动命令

## 本地启动

```bash
npm install
cp .env.example .env
npm start
```

然后打开：

```bash
curl http://localhost:3000/health
```

正常会返回：

```json
{
  "ok": true,
  "service": "shalonghui-runway-backend"
}
```

## 环境变量

在 `.env` 里填写：

```bash
RUNWAYML_API_SECRET=你的Runway API Key
ACTION_SECRET=你自己设置的访问密码
PORT=3000
RATE_LIMIT_PER_MINUTE=20
```

不要把 `.env` 上传到 GitHub，也不要把 Runway API Key 写进 GPT Instructions。

本地项目已经可以用 `.env` 配置运行；部署到 Render 时，仍然需要在 Render 的 Environment Variables 里填写同样的环境变量。

## 测试生成视频

```bash
curl -X POST http://localhost:3000/generate-video \
  -H "Content-Type: application/json" \
  -H "x-action-secret: 你的ACTION_SECRET" \
  -d '{
    "promptText": "A luxury black and electric blue technology brand opening scene, metallic dragon light silhouette, cinematic commercial style, vertical 9:16, no text, no people",
    "ratio": "720:1280",
    "duration": 5
  }'
```

## 查询任务状态

```bash
curl -X GET http://localhost:3000/get-task/你的taskId \
  -H "x-action-secret: 你的ACTION_SECRET"
```

## 部署到 Render

1. 新建 GitHub 仓库并上传本项目。
2. Render 选择 `New Web Service`。
3. Build Command 填 `npm install`。
4. Start Command 填 `npm start`。
5. Environment Variables 添加：
   - `RUNWAYML_API_SECRET`
   - `ACTION_SECRET`
6. 部署后，把 `openapi.yaml` 里的 `https://your-backend-domain.com` 换成 Render 给你的真实域名。

## GPT Action 认证设置

在 GPT Builder 的 Action Authentication 里选择：

- Auth Type: `API Key`
- API Key: 你的 `ACTION_SECRET`
- Auth Location: `Header`
- Header Name: `x-action-secret`

## GPT Instructions

可以把下面这段放进 GPT Builder 的 Instructions：

```text
你是沙龙会 AI 视频生成总控，负责调用 Runway 后端生成品牌视频镜头。

当用户要求生成视频镜头时：
1. 先把用户需求拆成单个 5-8 秒镜头。
2. 每个镜头生成英文 promptText。
3. 公开平台版本不得包含包赢、稳赚、暴富、赔率、诱导充值、绝对安全、100%保障等表达。
4. 默认使用 720:1280 竖屏比例。
5. 默认视频时长 5 秒，除非用户指定。
6. 调用 generateRunwayVideo 创建视频任务。
7. 返回 taskId、状态和下一步建议。
8. 如果用户要求先生成视觉图，再转视频，先调用 generateRunwayImage。
9. 用户询问任务进度时，调用 getRunwayTask。
10. 不要向用户索要或显示 Runway API Key。
11. 不要生成明显诱导赌博、规避平台审核、承诺收益的内容。
```

## 第一版镜头建议

| 镜头 | 任务 |
| --- | --- |
| 1 | 黑蓝科技龙影开场 |
| 2 | 综合娱乐生态矩阵 |
| 3 | 真人视讯氛围 |
| 4 | 电子游戏多屏 UI |
| 5 | 深海科技捕鱼 |
| 6 | 足球体育数据场景 |
| 7 | 公平规则可视化 |
| 8 | 安全机制系统 |
