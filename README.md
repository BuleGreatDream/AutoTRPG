# AI 人格化聊天室

一对一的 AI 人格化聊天室:依据「人设卡」进行角色扮演对话,具备**短期记忆**、**长期记忆**(向量语义召回)与**联网搜索**能力。简约聊天室 UI,原生前端 + Node.js + SQLite。

## 特性

- **人格化对话**:通过人设卡(名字/性格/背景/说话风格/开场白)驱动 AI 角色。
- **短期记忆**:同一会话内的最近 N 条消息构成上下文窗口。
- **长期记忆(摘要式)**:滑出窗口的旧对话被自动归纳成滚动摘要,跨会话保留关键信息,复用对话模型、无需 embedding。
- **联网搜索**:AI 通过 function calling 自主决定何时调用 Tavily 搜索实时信息。
- **表情包**:AI 通过 send_sticker 工具按情绪发送表情包,情绪→表情映射可自定义。
- **流式输出**:回复通过 SSE 逐字渲染。
- **本地持久化**:人设卡、会话、消息、记忆全部存于本地 SQLite。

## 技术栈

- 后端:Node.js (>=22.5) + Express
- 存储:SQLite(Node 内置 `node:sqlite`,零原生编译)
- 大模型:任意 OpenAI 兼容 `/chat/completions` 接口(DeepSeek / 通义 / Kimi / 智谱 / OpenAI 等)
- 长期记忆:摘要式(复用对话模型)
- 搜索:Tavily
- 前端:原生 HTML/CSS/JS

## 快速开始

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
# 编辑 .env,填入 OPENAI_BASE_URL / OPENAI_API_KEY / CHAT_MODEL
npm start
```

打开 http://127.0.0.1:3000

## 配置说明(.env)

| 变量 | 说明 |
|------|------|
| `OPENAI_BASE_URL` | 大模型 base URL(到 `/v1`) |
| `OPENAI_API_KEY` | 大模型密钥 |
| `CHAT_MODEL` | 对话模型名 |
| `TAVILY_API_KEY` | Tavily 密钥(不配则联网搜索关闭) |
| `ENABLE_LONG_TERM` | 摘要式长期记忆开关,默认 `true` |
| `SHORT_TERM_MESSAGES` | 短期记忆注入的最近消息条数(默认 20) |

> 联网搜索为**可选能力**,未配置 `TAVILY_API_KEY` 时自动关闭,不影响基础对话。长期记忆默认开启,复用对话模型。

## 表情包

AI 可通过 `send_sticker` 工具按情绪发送表情包。

- 映射文件:`public/stickers/stickers.json`,每个条目的 `emotion` 字段告诉 AI 该表情代表什么情绪。
- 图片:放在 `public/stickers/` 下,文件名与条目的 `file` 一致(如 `happy.png`)。缺图不报错,只是不显示。
- 增删表情:编辑 `stickers.json` 增删条目并放好图片即可,无需改代码。
- 详见 `public/stickers/README.txt`。

## 使用流程

1. 左侧「＋」新建人设卡,填写角色设定。
2. 选中人设 → 新建会话 → 开始对话。
3. AI 会保持人设口吻;需要实时信息时自动联网搜索;情绪合适时发表情包;跨会话记得历史。

## 安全提示

- 密钥仅存于 `.env`,不要提交到版本库(已在 `.gitignore` 忽略)。
- 服务默认监听 `127.0.0.1`,**无鉴权,仅供本机使用**。
- 若需暴露到公网或局域网,请自行在前面加反向代理 + 认证层,否则任何人都能访问你的对话与消耗你的 API 额度。
- 联网搜索返回的网页内容为不可信数据,仅作参考资料使用。

## 目录结构

```
├── server.js            Express 入口
├── src/
│   ├── config.js        配置与能力开关
│   ├── db.js            SQLite 与 DAO
│   ├── llm.js           OpenAI 兼容客户端 + tool-call 循环 + 摘要补全
│   ├── search.js        Tavily 搜索工具
│   ├── stickers.js      表情包映射与 send_sticker 工具
│   ├── memory.js        短期窗口 + 摘要式长期记忆
│   ├── persona.js       人设卡与 system prompt
│   └── chat.js          对话编排
└── public/
    ├── index.html / style.css / app.js   原生前端
    └── stickers/        表情包图片 + stickers.json 情绪映射
```
