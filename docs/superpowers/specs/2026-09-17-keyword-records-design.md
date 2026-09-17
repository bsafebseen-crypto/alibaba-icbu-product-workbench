# 关键词记录模块设计

## 目标

在现有“国际站运营工作台”中增加一个轻量的“关键词记录”模块，解决两件事：

1. 按阿里国际站 Product ID 查询和维护询盘关键词。
2. 查询和维护已经在直通车中屏蔽的关键词。

第一版只保存 Product ID、关键词、可选备注和创建时间，不保存产品名称、SKU、分类、图片、投放指标或历史版本。

## 范围与入口

- 在现有左侧导航增加“关键词记录”，保持当前浅色运营后台样式。
- 页面顶部包含“询盘词库”和“直通车屏蔽词”两个 Tab。
- 不修改 Obsidian 上品、1688 自动发品、阿里接口或其他现有业务流程。
- 所有操作均为本地数据维护，不调用阿里接口，不消耗模型 Token。

## 本地数据模型

数据保存在 `data/keyword-records.json`。使用单个 JSON 文件是因为当前项目没有数据库依赖，并且已有本地 JSON 持久化模式。逻辑结构保持简单：

```json
{
  "products": [
    {
      "id": "uuid",
      "product_id": "1601954851686",
      "created_at": "ISO-8601"
    }
  ],
  "inquiry_keywords": [
    {
      "id": "uuid",
      "product_id": "1601954851686",
      "keyword": "reflective safety vest",
      "note": "",
      "created_at": "ISO-8601"
    }
  ],
  "blocked_keywords": [
    {
      "id": "uuid",
      "product_id": null,
      "keyword": "fashion vest",
      "note": "流量不精准",
      "created_at": "ISO-8601"
    }
  ]
}
```

写入使用临时文件加重命名的原子替换方式。文件不存在时返回空集合；损坏文件返回明确错误，不静默覆盖。

## 校验与去重

- Product ID：字符串化后 trim，不能为空，只允许数字，同一文件中不可重复。
- 询盘关键词：trim 后不能为空；在同一个 Product ID 下按不区分大小写的关键词去重。
- 屏蔽关键词：trim 后不能为空；按“可空 Product ID + 不区分大小写关键词”去重。
- note：可选，保存前 trim。
- created_at：由服务端生成，编辑时保持原创建时间。
- 批量添加：按行拆分、trim、忽略空行、批内去重；已有重复项只计入 skipped，不导致整批失败。
- 删除 Product ID 时同时删除它的询盘关键词；不会删除同 Product ID 的屏蔽词，因为屏蔽词是独立记录。

## 服务端接口

新增独立本地接口，全部使用 JSON：

- `GET /api/keyword-records`：读取完整轻量数据集。
- `POST /api/keyword-records/products`：新增 Product ID。
- `DELETE /api/keyword-records/products/:id`：删除 Product ID 及其询盘词。
- `POST /api/keyword-records/inquiry-keywords`：新增一条询盘词。
- `PATCH /api/keyword-records/inquiry-keywords/:id`：编辑 keyword 和 note。
- `DELETE /api/keyword-records/inquiry-keywords/:id`：删除询盘词。
- `POST /api/keyword-records/inquiry-keywords/batch`：批量新增并返回 added/skipped。
- `POST /api/keyword-records/blocked-keywords`：新增一条屏蔽词。
- `PATCH /api/keyword-records/blocked-keywords/:id`：编辑 product_id、keyword 和 note。
- `DELETE /api/keyword-records/blocked-keywords/:id`：删除屏蔽词。
- `POST /api/keyword-records/blocked-keywords/batch`：批量新增并返回 added/skipped。

接口只返回关键词记录，不读取或返回任何 API 凭证和商品 Schema。

## 页面交互

### 询盘词库

- 左侧显示 Product ID、对应询盘词数量、搜索、新增和删除。
- 选中 Product ID 后，右侧显示当前 ID 的询盘词。
- 右侧支持关键词搜索、单条新增、编辑、删除和批量添加。
- 批量弹窗固定显示当前选中的 Product ID，每行一个关键词，保存后显示新增数和跳过重复数。

### 直通车屏蔽词

- 使用紧凑表格展示关键词、对应 Product ID、备注、添加时间和操作。
- 支持关键词搜索和按 Product ID 筛选。
- 支持单条新增、编辑、删除和批量添加。
- 批量弹窗中的 Product ID 可为空；保存结果显示新增数和跳过重复数。

弹窗使用原生 `<dialog>` 或与现有样式一致的轻量模态层，不引入 UI 框架。所有删除操作要求一次本地确认。

## 文件边界

- 新增 `src/keyword-record-store.js`：校验、去重、原子持久化和 CRUD。
- 新增 `public/keyword-records.js`：页面状态、渲染和交互。
- 新增 `tests/keyword-record-store.test.js` 和 `tests/keyword-records-ui.test.js`。
- 在 `src/server.js` 中仅增加依赖注入和路由。
- 在 `public/index.html` 中仅增加导航、模块 DOM 和脚本引用。
- 在 `public/app.js` 中仅增加新模块初始化接线；若独立模块可自行初始化，则不增加业务逻辑。
- 在 `public/styles.css` 中仅增加该模块所需的复用式样。

## 测试与验收

按测试驱动顺序实施：

1. 存储测试先失败，再实现 Product ID、询盘词、屏蔽词的校验、CRUD、批量去重和持久化。
2. 服务端测试先失败，再接入对应 HTTP 路由并核对状态码和响应结构。
3. UI 结构测试先失败，再增加导航、两个 Tab、左右布局、表格和批量弹窗。
4. 运行完整 `npm test`。
5. 启动本地服务并验证刷新后数据仍存在。

当前 `package.json` 只提供 `start` 和 `test`，没有 `lint`、`typecheck` 或 `build` 脚本。实现不新增工具链；最终报告将明确这些命令未配置，并提供完整测试与启动验证结果。

## 非目标

不增加产品名称、SKU、分类、图片、关键词类型、评分、CPC、曝光、点击、转化率、图表、历史版本、阿里接口同步、后台任务或自动分析。
