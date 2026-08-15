# 主产品 Schema 克隆与四份草稿预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解析线上主产品 Schema，只替换标题、主题卖点和 FAQ，并在本地生成四份不会提交到阿里的草稿预览 XML。

**Architecture:** 新增独立 `schema-template` 模块负责 XML 解析、字段角色识别和副本修改；阿里客户端继续只负责签名与只读读取。HTTP 层提供分析结果和预览生成接口，浏览器只展示识别状态、编辑文案和变更摘要，不展示或提交完整 XML。

**Tech Stack:** Node.js 20、原生 HTML/CSS/JavaScript、`node:test`、`fast-xml-parser` 5.10.1

## Global Constraints

- 不调用 `alibaba.icbu.product.schema.add.draft`。
- 不调用任何正式发布接口。
- 标题、主题卖点和 FAQ 之外的字段不得主动修改。
- 无法可靠识别的字段保留原值并产生警告。
- App Secret、Access Token 和完整授权响应不写入任务、日志或测试 fixture。
- 服务继续只监听 `127.0.0.1`。
- 当前目录不是 Git 仓库，因此所有提交步骤均记录为跳过，不初始化仓库。

---

### Task 1: Schema XML 分析与字段角色识别

**Files:**
- Create: `src/schema-template.js`
- Create: `tests/fixtures/product-schema.xml`
- Create: `tests/schema-template.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `analyzeProductSchema(schemaXml): SchemaAnalysis`
- Produces: `SchemaAnalysis = { fieldCount, recognized, warnings }`
- Produces: `recognized.title|productSummary = { fieldId, value } | null`
- Produces: `recognized.faq = { fieldId, items: Array<{question, answer}> } | null`

- [ ] **Step 1: 添加 XML 解析依赖**

Run: `npm install fast-xml-parser@5.10.1`

Expected: `package.json` 和 `package-lock.json` 记录直接依赖。

- [ ] **Step 2: 写入脱敏 fixture 和失败测试**

Fixture 必须包含 `subject`、`product_summary`、`product_faq`、`price`、`sku`、`main_image` 和一个未知字段。测试断言：

```js
const analysis = analyzeProductSchema(schemaXml);
assert.equal(analysis.recognized.title.value, 'Original Safety Vest');
assert.equal(analysis.recognized.productSummary.value, 'Original summary');
assert.deepEqual(analysis.recognized.faq.items, [
  { question: 'Can I add a logo?', answer: 'Yes.' },
]);
assert.equal(analysis.fieldCount, 7);
```

另写无效 XML 和缺少目标字段测试，分别要求抛出 `Schema XML 无效`、返回明确 `warnings`。

- [ ] **Step 3: 运行测试并确认 RED**

Run: `node --test tests/schema-template.test.js`

Expected: FAIL，因为 `src/schema-template.js` 尚不存在。

- [ ] **Step 4: 实现最小 XML 分析器**

使用 `XMLParser` 的 `preserveOrder` 模式遍历所有 `<field>`。把 `id`、`name` 统一转为小写字母数字身份串，匹配：

```js
const ROLE_PATTERNS = {
  title: /^(subject|productname|producttitle|title)$/,
  productSummary: /^(productsummary|sellingpoints|themesellingpoints)$/,
  faq: /^(productfaq|faq)$/,
};
```

普通字段值从 field 自身或第一个 `input/textarea` 的 `value` 读取。FAQ 从身份包含 `question` 和 `answer` 的后代输入节点按顺序配对。解析错误统一抛出中文错误。

- [ ] **Step 5: 运行测试并确认 GREEN**

Run: `node --test tests/schema-template.test.js`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

跳过：当前目录不是 Git 仓库。

### Task 2: 最小字段替换和预览 XML

**Files:**
- Modify: `src/schema-template.js`
- Modify: `tests/schema-template.test.js`

**Interfaces:**
- Consumes: `analyzeProductSchema(schemaXml)`
- Produces: `createProductPreview(schemaXml, variant): ProductPreview`
- Produces: `ProductPreview = { previewXml, changedFields, warnings }`
- Consumes: `variant = { title, sellingPoints, faq }`

- [ ] **Step 1: 写入失败测试**

测试用两个独立 variant 生成两份 XML，断言：

```js
assert.deepEqual(first.changedFields, ['title', 'productSummary', 'faq']);
assert.equal(analyzeProductSchema(first.previewXml).recognized.title.value, 'Variant One');
assert.equal(analyzeProductSchema(second.previewXml).recognized.title.value, 'Variant Two');
assert.equal(readField(first.previewXml, 'price'), '12.50');
assert.equal(readField(first.previewXml, 'sku'), 'SKU-001');
assert.equal(schemaXml.includes('Original Safety Vest'), true);
```

增加标题超过 128 字符、FAQ 缺少答案、目标字段未识别三个错误测试。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test tests/schema-template.test.js`

Expected: FAIL，因为 `createProductPreview` 尚未导出。

- [ ] **Step 3: 实现最小副本修改**

每次重新解析原始 XML，绝不修改共享节点树。普通字段只设置已识别 value carrier；FAQ 文本按以下格式解析：

```text
Q: Can I add a logo?
A: Yes.
```

FAQ 数量与原模板槽位一致时逐项替换；不一致时返回中文错误，避免猜测 Schema 的新增节点格式。用 `XMLBuilder` 的 `preserveOrder` 模式返回 `previewXml`。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `node --test tests/schema-template.test.js`

Expected: 全部 PASS，且原始 XML 变量内容未改变。

- [ ] **Step 5: 提交**

跳过：当前目录不是 Git 仓库。

### Task 3: HTTP 分析结果和四份本地预览

**Files:**
- Modify: `src/server.js`
- Modify: `src/alibaba-client.js`
- Modify: `tests/server.test.js`
- Modify: `tests/alibaba-client.test.js`

**Interfaces:**
- Consumes: `loadAlibabaProductTemplate(config, productId)`
- Consumes: `analyzeProductSchema(schemaXml)`
- Consumes: `createProductPreview(schemaXml, variant)`
- Produces: `POST /api/alibaba/product-template` 返回 `{sourceProductId, traceId, schemaXml, analysis}`
- Produces: `POST /api/products/preview` 接收 `{schemaXml, products}`，返回 `{previews}`

- [ ] **Step 1: 写入失败的 HTTP 测试**

扩展模板读取测试，要求响应包含 `analysis.recognized`。增加预览接口测试，传入四个产品后必须返回四份 `status: "preview"`，并验证注入的预览函数被调用四次。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test tests/server.test.js tests/alibaba-client.test.js`

Expected: FAIL，因为响应没有分析结果且预览路由不存在。

- [ ] **Step 3: 实现最小路由编排**

`createServer(options)` 增加可注入的 `analyzeProductSchema` 和 `createProductPreview`。模板路由读取后分析；预览路由验证产品数组长度必须为 4，再逐项创建预览：

```js
{
  index: product.index,
  sourceProductId: product.sourceProductId,
  status: 'preview',
  ...createProductPreview(schemaXml, product),
}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `node --test tests/server.test.js tests/alibaba-client.test.js`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

跳过：当前目录不是 Git 仓库。

### Task 4: 工作台识别状态与预览摘要

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/server.test.js`

**Interfaces:**
- Consumes: 模板响应中的 `analysis`
- Consumes: `POST /api/products/preview`
- Produces: 三个字段识别状态、继承范围摘要、“生成 4 份预览”按钮、当前版本变更摘要

- [ ] **Step 1: 写入失败的静态页面测试**

在 `tests/server.test.js` 断言页面包含：

```js
assert.match(html, /id="schema-recognition"/);
assert.match(html, /id="generate-previews"/);
assert.match(html, /id="preview-summary"/);
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test tests/server.test.js`

Expected: FAIL，因为三个元素尚不存在。

- [ ] **Step 3: 实现识别状态展示**

模板加载成功后，把原始标题、主题卖点和 FAQ 写入四个产品的初始编辑值。识别失败的角色显示“需确认”，同时禁用预览按钮。识别成功显示“已识别”。

- [ ] **Step 4: 实现预览请求和摘要**

点击按钮前同步当前产品，调用 `/api/products/preview`。成功后在每个产品上保存 `preview`，摘要只显示：修改字段、警告数量和“未提交到阿里”，不渲染 XML。

- [ ] **Step 5: 运行测试并确认 GREEN**

Run: `node --test tests/server.test.js`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

跳过：当前目录不是 Git 仓库。

### Task 5: 文档、完整验证和浏览器冒烟

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1-4 完整行为
- Produces: 用户可操作的本地预览流程说明

- [ ] **Step 1: 更新 README**

说明主产品读取、字段识别、四份本地预览、当前不创建阿里草稿，以及真实 Schema 校准时只使用只读接口。

- [ ] **Step 2: 运行完整测试**

Run: `npm test`

Expected: 0 failed。

- [ ] **Step 3: 运行语法和依赖检查**

Run: `node --check public/app.js`

Expected: exit 0。

Run: `npm audit --omit=dev`

Expected: 0 vulnerabilities。

- [ ] **Step 4: 浏览器冒烟测试**

重启本地服务，验证：页面布局无重叠；主产品区显示三个识别状态；使用脱敏 fixture 对应的本地 stub 可切换四个类似品；预览摘要明确写有“未提交到阿里”。

- [ ] **Step 5: 安全检查**

Run: `rg -n "appSecret|accessToken|apiKey|schema\.add|schema\.add\.draft" data src public tests`

Expected: 不存在真实密钥；生产代码不存在草稿或正式发布调用。

- [ ] **Step 6: 提交**

跳过：当前目录不是 Git 仓库。
