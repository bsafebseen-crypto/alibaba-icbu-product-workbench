# 国际站自动上品工作台 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地中文工作台，从图片和词表建立、编辑、AI 生成并保存 5 个商品版本。

**Architecture:** 使用 Node.js 20 内置 HTTP 服务提供静态页面和 JSON API，不引入前端框架或数据库。浏览器负责素材选择和编辑，服务端负责词表解析、OpenAI 兼容请求、结果校验与安全落盘。

**Tech Stack:** Node.js 20、原生 HTML/CSS/JavaScript、`node:test`、Windows CMD 启动器

## Global Constraints

- 第一版不调用阿里正式发布接口。
- API Key 只存在于当前服务进程内存，不写入磁盘、日志、浏览器存储或 Obsidian。
- 每次任务恰好包含 5 个商品版本。
- 不引入运行时 npm 依赖。
- 当前目录不是 Git 仓库，因此计划中的提交步骤记录为跳过，不擅自初始化仓库。

---

### Task 1: 核心领域逻辑和测试框架

**Files:**
- Create: `package.json`
- Create: `src/core.js`
- Create: `tests/core.test.js`

**Interfaces:**
- Produces: `parseWordList(text, fileName): string[]`
- Produces: `createManualProducts(): ProductDraft[]`
- Produces: `validateGeneratedProducts(value): ProductDraft[]`
- Produces: `sanitizeTaskForStorage(task): StoredTask`

- [ ] **Step 1: 写入失败测试**

覆盖 CSV/TXT 解析去重、固定创建 5 个手工版本、拒绝非 5 条 AI 结果、保存对象剔除 `apiKey`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test`
Expected: FAIL，因为 `src/core.js` 尚不存在。

- [ ] **Step 3: 实现最小领域函数**

使用纯函数完成解析、标准化和校验；`ProductDraft` 字段固定为 `index`、`kind`、`title`、`sellingPoints`、`keywords`。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test`
Expected: 核心测试全部 PASS。

- [ ] **Step 5: 提交**

跳过：当前目录不是 Git 仓库。

### Task 2: 本地任务存储和 AI 客户端

**Files:**
- Create: `src/task-store.js`
- Create: `src/ai-client.js`
- Create: `tests/task-store.test.js`
- Create: `tests/ai-client.test.js`

**Interfaces:**
- Consumes: `validateGeneratedProducts`、`sanitizeTaskForStorage`
- Produces: `saveTask(rootDir, task): Promise<{id, path, task}>`
- Produces: `testAiConnection(config, fetchImpl): Promise<{ok, message}>`
- Produces: `generateProducts(config, source, fetchImpl): Promise<ProductDraft[]>`

- [ ] **Step 1: 写入失败测试**

使用临时目录验证任务只能保存到 `data/tasks`、JSON 不含密钥；用假的 `fetch` 验证请求 URL、Authorization 头、JSON 提取和恰好 5 条校验。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test`
Expected: FAIL，因为存储和 AI 模块不存在。

- [ ] **Step 3: 实现最小存储和 AI 请求**

Base URL 去除尾部斜杠后拼接 `/chat/completions`；连接测试发送最短请求；生成请求要求 JSON 对象 `{products:[...]}`；任务 ID 使用日期和随机 UUID。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test`
Expected: Task 1 和 Task 2 测试全部 PASS。

- [ ] **Step 5: 提交**

跳过：当前目录不是 Git 仓库。

### Task 3: HTTP 服务 API

**Files:**
- Create: `src/server.js`
- Create: `tests/server.test.js`

**Interfaces:**
- Consumes: `parseWordList`、`createManualProducts`、`testAiConnection`、`generateProducts`、`saveTask`
- Produces: `createServer(options): http.Server`
- Produces endpoints: `GET /api/health`、`POST /api/ai/test`、`POST /api/products/manual`、`POST /api/products/generate`、`POST /api/tasks`

- [ ] **Step 1: 写入失败的 HTTP 测试**

在随机端口启动服务，验证健康检查、手工生成恰好 5 条、无效 JSON 返回 400、任务保存响应不泄漏 API Key。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test`
Expected: FAIL，因为 HTTP 服务尚不存在。

- [ ] **Step 3: 实现 API 与静态文件服务**

仅接受 JSON 请求，限制请求体为 10 MB，统一错误响应 `{error:string}`；静态文件只从 `public/` 读取并阻止路径穿越。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test`
Expected: 所有服务端测试 PASS。

- [ ] **Step 5: 提交**

跳过：当前目录不是 Git 仓库。

### Task 4: 整洁的单页工作台

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

**Interfaces:**
- Consumes: Task 3 的五个 HTTP endpoints
- Produces: 可操作的 AI 设置、文件导入、5 个标签页编辑器和保存反馈

- [ ] **Step 1: 建立静态页面验收测试**

在 `tests/server.test.js` 添加断言：`GET /` 返回 200，并包含“国际站自动上品”和 `app.js`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test`
Expected: FAIL，因为静态页面不存在。

- [ ] **Step 3: 实现页面**

左侧设置区不超过 360px，右侧只展示当前版本；窄屏时改为单列。文件在浏览器内读取为文件名和文本，不把图片二进制写进任务 JSON。API Key 输入使用 password 类型且不进入 localStorage。

- [ ] **Step 4: 运行测试并手工验收布局**

Run: `npm test`
Expected: 全部 PASS；桌面宽度下无文字覆盖，5 个版本可切换编辑。

- [ ] **Step 5: 提交**

跳过：当前目录不是 Git 仓库。

### Task 5: Windows 一键启动与端到端验证

**Files:**
- Create: `启动工作台.cmd`
- Create: `.gitignore`
- Create: `README.md`

**Interfaces:**
- Consumes: `src/server.js`
- Produces: 双击启动入口和用户操作说明

- [ ] **Step 1: 写启动验收要求**

启动器必须切换到自身目录、检测 Node、启动服务并打开 `http://127.0.0.1:54025/`；`data/tasks/` 和本地配置不进入版本控制。

- [ ] **Step 2: 实现启动器与文档**

README 明确说明哪些操作消耗模型 token、第一版不会发布阿里商品、API Key 不落盘、任务文件位置和停止服务方式。

- [ ] **Step 3: 执行自动化验证**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 4: 执行真实启动冒烟测试**

Run: `node src/server.js`
Expected: `GET http://127.0.0.1:54025/api/health` 返回 `{\"ok\":true}`，页面可打开并创建 5 个手工版本。

- [ ] **Step 5: 安全检查**

搜索 `data/tasks` 和代码输出，确认没有真实 API Key；确认服务只监听 `127.0.0.1`。

- [ ] **Step 6: 提交**

跳过：当前目录不是 Git 仓库。
