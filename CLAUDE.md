# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

AI 人格化聊天室：依据「人设卡」角色扮演的单聊 + 多角色群聊。Node.js + Express + `node:sqlite` 后端，Vue 3 + Vite 前端。代码与注释均为中文，保持一致。

## 常用命令

```bash
npm install
npm run build          # Vite 构建 → dist/（server.js 生产模式托管这里）
npm start              # 生产：单端口交付

npm run dev:server     # 后端，node --watch 自动重启
npm run dev:web        # 前端 5173，Vite HMR，/api 与 /stickers 代理到 3001
```

开发时两个终端各跑一个，浏览器开 `http://localhost:5173`。**改了 `web/` 下的东西又要用 `npm start` 验证，必须先 `npm run build`** —— 生产模式只认 `dist/` 里的构建产物。

要求 Node >= 22.5（`node:sqlite`）；本机为 v24。`.env` 需先从 `.env.example` 复制并填 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `CHAT_MODEL`。

**端口分散在三处**：`vite.config.js` 的代理目标**硬编码** `127.0.0.1:3001`，`.env` 的 `PORT`，以及 `config.js` 里 `num(process.env.PORT, 3000)` 的兜底默认值 3000。`.env.example` 已统一成 3001 并加了提醒，但**改端口时 `vite.config.js` 必须一起改** —— 不改的话 `dev:web` 的 `/api` 代理全打空，界面一片空白、控制台只有 404。

**项目没有测试框架、没有 linter，也没有类型检查。** 验证靠手动：改后端就 `npm run dev:server` + curl 打接口看状态码与 SSE 事件；改前端就跑 dev:web 在浏览器里走一遍。别声称跑过测试。注意任何真实对话验证都会往 `data/chat.db` 写数据并真的调模型 API 花钱，做之前告知用户。

`data/`、`dist/`、`.env`、`截图/`、`迁移流程/` 都在 `.gitignore` 里 —— 后两者只在本机存在，写文档时不要引用它们的内容当依据。

## 核心架构

### 请求链路

单聊与群聊共用同一套生成管线，只有「落库字段」与「谁来说」不同：

```
server.js  路由 + runSSE(sse.js) 包出 SSE 流
   ├─ chat.js       1v1：拼 system 人设 + 长期记忆 + 短期窗口
   └─ groupchat.js  群聊：导演决策谁发言 → 循环调度成员
          ↓ 两者都调
      reply.js  streamReply：逐句切分 + 表情包上限 + 剥标记模仿
          ↓
      llm.js    streamChat：OpenAI 兼容 SSE + tool-call 循环（最多 4 轮）
          ↓
      segmenter.js  按中英句末标点/换行把 token 流切成一句句
```

`reply.js` 只负责把模型输出变成「一句句文字 + 至多 N 个表情包 + 文件卡片」，通过回调吐出；**落库由调用方在回调里做**（`chat.js` 写 `messages` 表，`groupchat.js` 写 `group_messages` 并带 `speakerPersonaId`）。

### 加一种消息形态要动的五处

「新增一种输出形态」（比如图片卡片、投票卡）是这个项目最容易漏改的操作，一条链贯穿前后端：

1. `reply.js` `streamReply` 加 `onXxx` 回调（记得先 `segmenter.flush()` 保证文字在前）
2. `chat.js` **和** `groupchat.js` 各自在回调里落库（两处，字段不同）
3. `server.js` 的 `/api/chat` 与 `/api/group-chat` 把回调转成 SSE 事件 `send('xxx', ...)`
4. `useChatStream.js` 的事件分支 `else if (event === 'xxx')` push 进 queue，consumer 里再 `onPush` 一条 `kind: 'xxx'`
5. `MessageBubble.vue` 加 `v-else-if="msg.kind === 'xxx'"` 分支

**`kind` 字段有两个生产者**：历史消息由后端 `serialize.js:contentView()` 算出，流式消息由 `useChatStream.js` 手写。两边对不上的症状是「刚发的消息显示正常，刷新后变成空气泡」（或反之）。

若这个形态还要**独立落库**，另见下面的内部标记一节。

### 内部内容标记（最容易踩的坑）

表情包和文件作为**独立消息**落库，content 列存内部标记：

- `\x01STICKER:<id>`（`stickers.js`）
- `\x01FILE:{json}`（`files.js`）

**这些标记绝不能原样喂给模型** —— 模型会照抄格式把字面量当正文输出（连 UUID 一起抄），前端就渲染出一串裸标记。所有出口都必须过 `serialize.js`：

- `contentView(content)` → 前端渲染视图（`kind: 'sticker' | 'file' | 'text'`）
- `modelText(content, {role, who})` → 给模型/摘要/导出的自然语言（返回 `null` 表示这条不进上下文，即 assistant 自己发的表情包）

`reply.js` 的 `stripMarkerMimicry()` 是最后一道兜底，剥掉模型已经学会照抄的标记串。

加新标记类型时，**同一件事有五个出口要一起改**：`serialize.js:contentView()`（前端视图）、`serialize.js:modelText()`（模型上下文）、`serialize.js:mdQuote()`（Markdown 导出）、`groupchat.js:lineOf()`（群聊转录给导演与成员看）、`memory.js` 里 `summarizeSession`/`summarizeGroup` 各自手写的 transcript 拼接（这两处没走 `modelText`，是重复实现）。

### 前端流式渲染

`web/src/composables/useChatStream.js` 消费 SSE：事件先进 `queue`，由一个 consumer 协程按「打字延迟」逐条渲染，制造真人节奏（已读回执、正在输入）。`stillHere()` 用 `chatKey` 判断用户是否已切走，切走后抑制渲染。这一段是从旧原生 `app.js` 一比一搬来的，改动前先确认行为等价。

### 模型行为都写在 prompt 里

用户抱怨「AI 老发表情包 / 不主动说话 / 动不动生成文件 / 乱联网搜索」时，改的是 prompt 而不是代码逻辑：

- `persona.js:buildSystemPrompt()` —— 1v1 的全部行为约束：沉浸人设、主动抛话题、联网搜索克制（`features.webSearch` 才拼）、表情包克制（`hasStickers` 才拼）、逐句短句表达、`create_file` 仅在用户明确要求时。
- `groupchat.js:memberContext()` —— 群聊成员额外的「只以自己身份说话、别替别人发言、可主动挑话题」。
- `groupchat.js:directorDecide()` —— 导演的选人策略（「真实群聊通常只有一两个人接话」「倾向返回空列表让它停下」）。想让群聊更热闹/更安静，调这里的措辞与 `remaining` 表述。
- 各工具的 `description` 也承载行为约束：`stickers.js:buildStickerTool()`、`filetool.js:buildFileTool()`、`search.js:webSearchTool`、`knowledge.js:buildKnowledgeTool()`。

注意 system prompt 是按 `features` 开关**条件拼接**的：没配 `TAVILY_API_KEY` 时整段搜索约束都不存在，缺表情包图片时表情包约束也不拼。调 prompt 前先确认对应能力是开着的。

### 加一个模型工具

`llm.js` 是唯一的工具注册处，四步：

1. 新文件里写 `buildXxxTool()` 返回 OpenAI function schema（description 里把使用时机与克制要求写清楚，模型只看这段）
2. `llm.js:toolHandlers` 加 `name → async (args, ctx) => result`，`ctx` 带 `personaId` / `groupId`
3. `llm.js:availableTools()` 决定挂载条件（按 `features` 开关或授权情况）
4. 需要给前端推事件（如搜索提示、文件卡片）则在 `streamChat()` 的 tool-call 分派里加分支 —— 注意 `search_knowledge` 是故意静默的，不推 `onToolCall`

tool-call 循环上限 4 轮，超了做一次无工具收尾。

### 记忆

- **短期**：`memory.js:shortTerm()` 取该会话最近 `SHORT_TERM_MESSAGES` 条，经 `modelText` 翻译后拼上下文。群聊不走它，用 `groupchat.js:transcriptOf()` 取最近 30 条纯文本转录。
- **长期**：每个人设**一条滚动摘要**（`memories` 表，persona_id 为主键），归纳时把旧摘要与新会话全文融合后**整体覆盖**。因此只能整体清空（`DELETE /api/personas/:id/memory`），无法按会话删除。
- 归纳**不在对话过程中发生**，只在用户删除会话/群聊并选「保留」时触发（`DELETE /api/sessions/:id?summarize=true`）。群聊会**为每个成员各归纳一次**，以该成员为「我」写进各自的摘要。
- `sessions.summarized_upto` 列、`sessions.setSummarizedUpto()`、`messages.between()` 是早期「滑出窗口自动归纳」设计的残留，**当前无任何调用方**。`.env.example` 与 `config.js` 里「滑出窗口的旧消息会被自动归纳」那句注释同样过时。别照着它们推断行为。

### 群聊导演

`groupchat.js:directorDecide()` 用非流式 `complete()` 让模型输出 `{"responders":[id,...]}`（`extractJson()` 容错解析 ```json 代码块与夹带文字）。三重防循环：导演可返回空列表停下、`group.max_responses` 上限（建群时约束在 1..10）、同一轮同成员不重复入队。首轮导演给空列表时兜底让第一个成员回应一次。

**一次群聊发言的模型调用数是 1 + 2N**（首轮导演 + 每个成员各一次流式生成 + 每次发言后一次追问导演）。`max_responses` 默认 3，即最多 7 次调用。测群聊比测单聊贵得多，跑之前告知用户。

### 资料库授权

检索范围 = **人设授权 ∪ 群聊授权**（`persona_kb` ∪ `group_kb`，`knowledge.js:authorizedEntries()`）。`search_knowledge` 工具只在有授权条目时才挂载，且 description 里列出条目标题目录让模型知道有什么可查。检索是简单子串匹配（任一分词命中标题或正文），不用 embedding；**一个都没命中时退化为返回全部授权条目**（截断到 5 条），不是返回空。群聊里每个成员只能查自己那份并集。

`knowledge.js:hasKnowledge()` 目前没有调用方（挂载判断走 `buildKnowledgeTool()` 返回 null）。

### 登录鉴权

**单用户口令门**：登录只管「谁能进门」，业务表**一律不带 `user_id`** —— 任何账号登录后看到的都是同一份人设卡/会话/群聊/资料库。别在代码里假设数据按账号隔离。

- `src/auth.js` —— scrypt 密码哈希（`salt:hash` hex，`timingSafeEqual` 比对）、令牌生成、cookie 读写、登录失败限流（内存 Map，5 次锁 5 分钟）。**零新依赖**：`node:crypto` + 手写 cookie 解析。
- 令牌存 `auth_sessions` 表而非内存 —— `dev:server` 带 `--watch`，存内存每改一个文件就掉一次登录。**这张表和「聊天会话」`sessions` 表毫无关系，只是名字像。**
- `server.js` 里 `/api/auth/*` 四个接口注册在鉴权中间件**之前**，是唯一免登录的 `/api` 路由；之后一道 `app.use` 拦下所有 `/api/*`，未登录回 `401 {error:'未登录'}`。加新接口默认就是受保护的，不用做什么。
- **静态资源不拦**：`dist/` 的 HTML/JS 照常公开。登录界面本身是 SPA 的一部分，藏 JS 没有安全收益，门在 API 上。

**为什么用 cookie 而不是 `Authorization` 头**：群聊导出 `<a href="/api/groups/:id/export">` 与文件下载 `<a href="/api/files/:id">` 是浏览器直接导航，加不了自定义头。cookie（`HttpOnly` + `SameSite=Lax` + `Path=/`）浏览器自动带，SSE 的同源 fetch 也自动带 —— 所以 `useChatStream.js` 与那两个下载链接**都不需要为鉴权改动**。

前端：`stores/auth.js` 存登录态（`user` / `checked` / `allowRegister`），`App.vue` 三态 gate（`!checked` 空白 → `!user` 登录页 → 主界面）。`auth.checked` 是为了避免已登录用户首屏闪一下登录页。**`initChat()` 必须等 `auth.user` 有值才能调**（`App.vue` 里的 `watch`）—— 它要打 features/personas/groups 三个接口，未登录时全是 401。`api/index.js` 的 `toError()` 撞到 401 会自动把 `auth.user` 清空退回登录页，但**排掉了 `/api/auth/` 开头的请求**，否则密码输错也会被当成令牌过期。

`ALLOW_REGISTER=false` 可关掉注册入口（`/api/auth/me` 把该开关回给前端，登录页据此隐藏「注册」）。已有账号后仍允许注册。

### 数据层

`src/db.js` 一个文件包含建表 SQL 与所有 DAO（`personas` / `sessions` / `messages` / `memories` / `groups` / `groupMessages` / `kbCategories` / `kbEntries` / `personaKb` / `groupKb`）。要点：

- 1v1 与群聊消息是**两张独立表**，`group_messages.speaker_persona_id` 标记该 assistant 消息由哪个成员所说（user 消息为 NULL）。
- **`node:sqlite` 没有 `db.transaction()`**，需要事务的地方手写 `db.exec('BEGIN')` / `COMMIT` / `ROLLBACK`（见 `groups.create`、`personaKb.setFor`、`groupKb.setFor`）。
- 建表用 `CREATE TABLE IF NOT EXISTS`，无迁移框架。加列走建表 SQL 后面那种 try/catch 包住的 `ALTER TABLE`（幂等靠忽略「列已存在」的报错）。
- 人设头像以 base64 data URL 存 `personas.avatar` 列，前端 `useAvatar.js:resizeImageToDataUrl()` 先缩到 256px 控制体积。
- **`kb_entries.category_id` 是 `NOT NULL`，但 `kbEntries.update()` 遇到 `categoryId == null` 会跳过该列** —— 这是在规避约束，不是 bug。后果：「设为未分类」会返回 200 却什么都没改。前端 `KbView.vue` 因此不提供该选项、`kb.js:saveEntry()` 另加一道拦截。要支持未分类得先改 schema。
- 新建会话时若人设有 `greeting`，会作为第一条 assistant 消息落库（`server.js` 的 `POST /api/sessions`），所以新会话不是空的。
- 登录相关两张表见上面「登录鉴权」一节：`users` + `auth_sessions`（后者 `ON DELETE CASCADE` 挂在 `users` 上，删账号会连带清掉其登录会话）。

### 前端结构

无 vue-router、无 Pinia，均为迁移时的明确决策：四个板块靠 `activeView` 切显隐、无 URL 需求；五个 store 级数据量裸响应式就够，依赖保持克制（前端只有 `vue` + `vite` + `@vitejs/plugin-vue`）。同期还决定不引 UI 库、不上 TypeScript。

- 板块切换靠 `App.vue` 一个 `activeView` ref + `v-if`，各板块进入时才挂载、数据在各自的 `onMounted` 里加载。**聊天室是例外**：`initChat()` 在 `App.vue` setup 里调一次，所以切走再切回不会重新拉人设/群聊列表（在别的板块改了人设，回到聊天室看到的还是旧列表）。
- 状态是 `web/src/stores/*.js` 里的 `reactive()` 模块（chat / personas / kb / settings），组件直接 import。
- 接口路径集中在 `web/src/api/index.js` 的 `endpoints`，不要在组件里拼字符串。
- `chat._sendingKeys` 用普通对象而非 Set —— `reactive()` 不深层代理 Set 的方法（`stores/chat.js` 顶部注释还写着 Set，已过时）。
- 跨栏通信走 chat store 的 `_showDelete` / `_showGroupModal` / `deleteTarget`（ChatPane 设、ChatView 读），不用事件冒泡。
- 弹窗交互仍有原生 `prompt()` / `confirm()`（新建分类、各处删除确认、退出登录），是忠实迁移的遗留，不是漏改。
- 登录页 `views/LoginView.vue` 在三栏骨架**之外**（`App.vue` 的 gate 分支），样式单独在 `styles/auth.css`，沿用 base/layout/chat/forms/modal 的拆分惯例。「退出登录」放在设置板块中栏 `SettingsPane.vue`（原来只有一句说明，底部空着）。

## 约束与陷阱

**Vite 输出目录必须是 `dist/`，不能是 `public/`。** `src/stickers.js` 要读 `public/stickers/stickers.json`，而 Vite 的 `emptyOutDir` 会清空输出目录。`server.js` 分两层挂载：`dist`（仅生产）+ `/stickers`。

**开发/生产模式由 `--watch` 判定**（`server.js` 顶部的 `isDev`）：`npm run dev:server` 带 `--watch` 就跳过 dist 静态托管，后端只做 API。所以生产模式下 dist 不存在会直接 404，而不是回退到别处。

**前后端有几组必须手动同步的常量**：`web/src/stores/chat.js` 的 `GROUP_FILE_EXTS` / `GROUP_FILE_MAX_BYTES` 对应后端 `src/groupfile.js` 的 `TEXT_EXTS` / `MAX_CONTENT_BYTES`。

**群文件上传不走 multipart**：body 直接是 `text/plain` 正文，文件名走 query（`POST /api/groups/:id/files?filename=`），为的是不引入依赖。文件会转成资料库条目（分类名固定「{群名}群文件」）并**增量**授权给该群（`groupKb.addFor`，不冲掉手工勾选）；同名条目是覆盖而非新增。

**设置改模型配置是双写**：`PUT /api/settings` 同时改内存里的 `config.chat`（立即生效）和 `.env`（`env-file.js` 就地替换，保留注释与其他键）。`GET /api/settings` 只回 `apiKeySet` 布尔值，不回密钥明文——保持这个约定。前端 `settings.apiKey` 留空时**不提交该字段**，后端也把空串视为「不改动」，双保险防误清空。

**`public/stickers/` 目前只有 `stickers.json` 和 `README.txt`，图片文件缺失。** 前端 `img @error` 会把气泡移掉，这是既有状态不是 bug，别去追。

**有登录鉴权，但默认只监听 127.0.0.1，且 cookie 没加 `Secure`。** 明文 HTTP 下令牌会裸奔，所以「有登录」不等于「可以放公网」——要暴露出去仍需反向代理 + HTTPS，届时给 cookie 补 `Secure`。新增接口时不要引入面向公网的假设。

## 已知回归（待用户拍板）

`web/src/views/ChatView.vue` 的 `watch(currentChatKey)` 里调了 `stream.abort()`，切会话会把后端 SSE 生成整段掐断。旧原生 `app.js` 是**刻意不中断**的：让后端继续逐句落库，只用 `stillHere()` 抑制渲染，切回来重拉即见完整内容。当前中途切走会永久丢掉未生成部分。修法是去掉 abort，保留 `stillHere()` 抑制 + `useChatStream.js` `finally` 里已有的 `reloadCurrent()` 分支（该分支当前被 abort 抢先而不可达）。这属于 Vue 迁移引入的回归，动之前先问用户。

## 迁移类 bug 的排查套路

前端症状常是「UI 位置/样式全错」或「某功能静默失效」，根因通常两类：

1. **DOM 层级放错** → CSS 后代选择器失配。`chat.css` 里大量 `.父 .子` 选择器，模板把节点写成兄弟就失效（典型：已读回执必须在 `.msg.user` 内部）。
2. **旧代码读 DOM 的地方没接上响应式变量** → 变成常量。

「界面一个字都不出」这类问题先 curl 打后端确认状态码：后端 400/404 返回的是 JSON 而非 SSE，当 SSE 硬解就是静默无输出。`api/index.js` 的 `api.get/send` 与 `useChatStream.js` 都已检查 `res.ok`，但新写的 fetch 容易漏。
