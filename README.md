# AI 人格化聊天室

依据「人设卡」进行角色扮演的 AI 聊天室,支持**单人对话**与**多角色群聊**,具备长期记忆、联网搜索、资料库检索、文件导出等能力。原生前端 + Node.js + SQLite,零构建、零原生编译。

## 功能特性

### 对话
- **人格化对话**:通过人设卡(名字/性格/背景/说话风格/开场白/头像)驱动 AI 角色,始终保持口吻。
- **逐句流式输出**:回复通过 SSE 一句一句发送,模拟真人打字节奏(含「已读」「正在输入」)。
- **主动发起话题**:话题冷场或用户敷衍时,AI 会自然地抛出贴合人设的新话题。
- **表情包**:AI 通过 `send_sticker` 工具按情绪发送表情包,情绪→表情映射可自定义。

### 多角色群聊
- 把多个人设卡编排进同一群聊,由一个「导演 AI」动态调度:决定每轮谁回应、顺序如何。
- **三重防循环**:导演可随时结束、单次发言总回应数有上限(建群可配)、单成员单轮只发一次。
- **群聊主题/场景**:建群可设定场景,导演与成员据此融入对话。
- **对话导出**:一键把群聊记录导出为 Markdown 文件。

### 记忆
- **短期记忆**:同一会话最近 N 条消息构成上下文窗口。
- **长期记忆(摘要式)**:删除会话/群聊时,可选择把对话归纳进长期记忆——单聊归纳进该人设,群聊则**分别归纳进每个成员各自的视角记忆**。复用对话模型,无需 embedding。

### 资料库(知识库)
- 「分类 + 条目(标题+正文)」结构管理知识;条目可归入分类。
- 每张人设卡按条目授权可读范围;对话时 AI 通过 `search_knowledge` 工具**按需检索**获授权的资料。
- 授权按人设隔离——群聊里每个成员只能查自己获授权的资料。

### 文件导出
- AI 可通过 `create_file` 工具把内容生成为可下载的 **txt / md** 文件(仅在用户明确要求时触发)。
- 文件为临时文件(2 小时过期清理),对话内以下载卡片呈现。

### 登录
- 账号密码登录,首次访问先注册。密码用 scrypt 加盐哈希存储,登录态是 httpOnly cookie(有效期 30 天)。
- 登录失败 5 次锁定 5 分钟,防口令爆破。
- **登录只是「进门」**:所有账号共享同一份人设卡/会话/群聊/资料库,不做按账号的数据隔离。
- 可用 `ALLOW_REGISTER=false` 关掉注册入口(已有账号仍能登录)。

### 设置
- 运行时切换大模型 `Base URL / 模型名 / API Key`,写回 `.env` 持久化且**立即生效无需重启**。

## 技术栈

- 后端:Node.js (>=22.5) + Express
- 存储:SQLite(Node 内置 `node:sqlite`,零原生编译)
- 大模型:任意 OpenAI 兼容 `/chat/completions` 接口(DeepSeek / 通义 / Kimi / 智谱 / OpenAI 等)
- 搜索:Tavily(可选)
- 前端:Vue 3 + Vite（SPA，构建后由 Express 静态托管）

## 快速开始

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
# 编辑 .env，填入 OPENAI_BASE_URL / OPENAI_API_KEY / CHAT_MODEL
npm run build          # 构建前端
npm start              # 启动服务（默认 http://127.0.0.1:3001）
```

首次打开会看到登录界面，点「注册」创建第一个账号即可进入。

> 若修改 `.env` 里的 `PORT`，记得把 `vite.config.js` 里 dev 代理的目标端口一起改，否则 `npm run dev:web` 的接口请求会打空。

### 开发模式

后端与前端分开启动，前端改动热更新（HMR）：

```bash
npm run dev:server     # 后端 3001，node --watch 自动重启
npm run dev:web        # 前端 5173，Vite dev server + HMR
```

开 http://localhost:5173 开发，接口自动代理到 3001。

打开 http://127.0.0.1:3001(端口由 `.env` 的 `PORT` 决定)。

## 配置说明(.env)

| 变量 | 说明 |
|------|------|
| `OPENAI_BASE_URL` | 大模型 base URL(到 `/v1`) |
| `OPENAI_API_KEY` | 大模型密钥 |
| `CHAT_MODEL` | 对话模型名 |
| `TAVILY_API_KEY` | Tavily 密钥(不配则联网搜索关闭) |
| `ENABLE_LONG_TERM` | 摘要式长期记忆开关,默认 `true` |
| `ALLOW_REGISTER` | 是否开放注册入口,默认 `true` |
| `SHORT_TERM_MESSAGES` | 短期记忆注入的最近消息条数(默认 20) |
| `PORT` / `HOST` | 服务监听端口与地址(默认 `3001` / `127.0.0.1`) |

> 大模型配置也可在应用内「设置」板块修改,会写回 `.env`。联网搜索、长期记忆均为可选/可关能力。

## 界面板块

应用最左为图标导航条,分四个板块:

1. **聊天室** — 选人设开单聊,或进群聊;多角色对话、逐句渲染、文件卡片。
2. **人设卡** — 新建/编辑人设卡(含头像上传、资料授权),右侧内联编辑。
3. **资料库** — 管理分类与条目,供人设按需检索。
4. **设置** — 切换大模型接口配置。

## 使用流程

1. 「人设卡」板块新建至少一张人设卡(填角色设定,可上传头像、授权可读资料)。
2. 「聊天室」选中人设 → 新建会话 → 开始对话;或点群聊「＋」选多个人设建群。
3. AI 保持人设口吻;需要实时信息时自动联网搜索;获授权时查阅资料库;明确要文件时导出 txt/md;情绪合适时发表情包;删除会话时可选择沉淀为长期记忆。

## 表情包

映射文件 `public/stickers/stickers.json`,每条的 `emotion` 描述情绪、`file` 指向 `public/stickers/` 下的图片。增删条目并放好图片即可,无需改代码。缺图不报错。详见 `public/stickers/README.txt`。

## 安全提示

- 密钥仅存于 `.env`,已在 `.gitignore` 忽略,不会提交到版本库。请勿分享 `.env` 本身。
- 服务有账号密码登录,但默认监听 `127.0.0.1`,**仅供本机使用**。登录 cookie 未设 `Secure`(本机是明文 HTTP,设了浏览器就不发送了),因此**明文 HTTP 下令牌可被嗅探**——要暴露到公网/局域网,请自行加反向代理 + HTTPS,并给 cookie 补上 `Secure`。
- 联网搜索返回的网页内容、资料库内容均视为参考资料。

## 目录结构

```
├── server.js              Express 入口 + 所有 HTTP/SSE 路由
├── src/
│   ├── config.js          配置与能力开关
│   ├── auth.js            密码哈希 / 令牌 / cookie / 登录限流
│   ├── db.js              SQLite 建表与各表 DAO
│   ├── llm.js             OpenAI 兼容客户端 + tool-call 循环
│   ├── reply.js           单个成员逐句流式回应(1v1 与群聊共用)
│   ├── chat.js            1v1 对话编排
│   ├── groupchat.js       群聊导演编排(动态多轮 + 防循环)
│   ├── memory.js          短期窗口 + 摘要式长期记忆(单聊/群聊归纳)
│   ├── persona.js         人设卡与 system prompt
│   ├── knowledge.js       资料库检索工具(search_knowledge)
│   ├── filetool.js        文件生成工具(create_file)
│   ├── files.js           临时文件存储与清理
│   ├── search.js          Tavily 联网搜索工具
│   ├── stickers.js        表情包映射与 send_sticker 工具
│   ├── segmenter.js       流式文本逐句切分
│   ├── serialize.js       面向前端的数据序列化
│   ├── sse.js             SSE 流式响应工具
│   └── env-file.js        .env 读改写(设置持久化)
├── web/                  Vue 3 前端源码
│   ├── index.html        入口 HTML
│   └── src/
│       ├── App.vue        三栏骨架
│       ├── api/           API 封装 + 路径表
│       ├── stores/        响应式状态（chat / personas / kb / settings / auth）
│       ├── composables/   useChatStream（SSE 流式）/ useAvatar
│       ├── components/    NavRail / AvatarImg / MessageBubble / KbAuthList
│       ├── views/         各板块中栏 + 主区 + 弹窗 + LoginView（登录/注册）
│       └── styles/        CSS 按 base / layout / chat / forms / modal / auth 拆分
├── dist/                  构建产物（npm run build → Express 托管）
├── vite.config.js         Vite 配置（root:web，dev 代理到 3001）
└── public/
    └── stickers/          表情包图片 + stickers.json 情绪映射
```
