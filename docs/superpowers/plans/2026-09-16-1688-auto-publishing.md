# 1688 自动发品实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 逐项执行；每个行为先写失败测试，再写最小实现。不得调用真实 1688 写接口，不得改动或清理用户已有未提交修改和 `data` 目录。

**目标：** 在现有国际站运营工作台中加入与 ICBU 完全隔离的 1688 单商品发布模块，完成配置、OAuth、只读连接、动态 Schema、图片、预览、预检、安全发布状态机及只读对账。

**架构：** 服务端新增独立 1688 客户端、Schema 适配、任务存储、状态机和对账模块；浏览器新增独立页面控制器及独立凭据键。真实发布适配器存在但受服务端写入开关、能力诊断、任务版本、请求指纹和一次性写机会共同保护。测试全部注入 fake fetch/client。

**技术栈：** Node.js 20+、原生 ESM、`node:http`、原生浏览器 JavaScript、`node:test`。

---

## 执行约束

- 当前 worktree 已包含用户未提交修改：`public/obsidian-publishing.js`、`src/server.js`、`tests/obsidian-publishing-ui.test.js`、`tests/server.test.js` 和 `data/`。必须保留并在其基础上做最小补丁。
- 不执行 `git reset`、`git checkout`、清理或覆盖 `data/`。
- 不提交 Git commit，除非用户另行要求；通过 `git diff` 区分本任务新增内容。
- 测试不得读取本机真实 Token，不得访问真实写接口。
- 默认 `ALLOW_1688_WRITES` 为关闭；自动测试中即使环境变量存在也必须通过 fake client 验证。

## Task 1：独立 1688 客户端与签名

**文件：**

- 新建：`src/1688-client.js`
- 新建：`tests/1688-client.test.js`

**步骤：**

1. 先写失败测试，定义独立配置校验、HTTPS 网关、1688 param2 请求路径、参数编码和签名的确定性行为。
2. 运行 `node --test tests/1688-client.test.js`，确认因模块不存在而失败。
3. 最小实现 `normalize1688Config`、`sign1688Request` 和通用 `call1688Api`；错误对象仅保留安全的 `code/requestId/message/uncertain`。
4. 增加失败测试，覆盖 OAuth 授权 URL、授权码换 Token、Refresh Token 刷新及 Token 脱敏。
5. 实现独立 OAuth 方法；不得导入或调用 `src/alibaba-client.js`。
6. 增加失败测试并实现只读方法：类目搜索、类目查询、主 Schema、子 Schema、商品列表和商品详情。
7. 增加失败测试并实现图片上传与 `alibaba.new.product.add` 适配器；只验证构造，不允许测试发往真实网关。
8. 运行该测试文件，预期全部通过。

## Task 2：动态 Schema、请求模型和本地预检

**文件：**

- 新建：`src/1688-schema.js`
- 新建：`tests/1688-schema.test.js`

**步骤：**

1. 写失败测试定义 `categoryType -> scene` 映射及非法类目处理。
2. 写失败测试定义官方 `bizData` JSON 解析、字段展平、必填/可见/只读/类型/枚举/范围规则。
3. 写失败测试定义主 Schema 与子 Schema 的安全合并以及规则哈希变化。
4. 写失败测试定义未支持但必填的组件必须阻止发布。
5. 写失败测试定义 `global + formValues` 请求体组装、稳定摘要和 SHA-256 指纹，摘要中不得包含 Token、密钥或图片二进制。
6. 最小实现上述行为。
7. 运行 `node --test tests/1688-schema.test.js`，预期全部通过。

## Task 3：任务存储、状态机和防重复提交

**文件：**

- 新建：`src/1688-task-store.js`
- 新建：`src/1688-publishing-state.js`
- 新建：`tests/1688-task-store.test.js`
- 新建：`tests/1688-publishing-state.test.js`

**步骤：**

1. 写失败测试定义 1688 独立文件前缀、原子写入、版本 CAS 和服务重启恢复。
2. 写失败测试证明 App Secret、Access Token、Refresh Token、授权码和图片二进制会在持久化前被拒绝或剥离。
3. 实现最小安全任务存储，不修改现有 Obsidian 任务格式。
4. 写失败测试定义状态转换、请求指纹、写机会消耗、重复点击和并发冲突。
5. 写失败测试定义 `publishing` 重启后只能恢复为 `uncertain`，不能再次写入。
6. 实现状态机和一次性写机会判断。
7. 分别运行两个测试文件，预期全部通过。

## Task 4：发布后只读对账

**文件：**

- 新建：`src/1688-publication-reconciliation.js`
- 新建：`tests/1688-publication-reconciliation.test.js`

**步骤：**

1. 写失败测试定义已知商品 ID 时调用 `alibaba.product.get` 核验关键字段和状态。
2. 写失败测试定义未知商品 ID 时按唯一货号、类目和窄时间窗口调用 `alibaba.product.list.get`。
3. 覆盖零匹配、多匹配、唯一匹配、审核中、已上架、被退回和查询错误。
4. 写失败测试定义退避计划，并证明对账代码永远不调用发布方法。
5. 最小实现对账和安全记录。
6. 运行该测试文件，预期全部通过。

## Task 5：服务端只读路由和依赖注入

**文件：**

- 修改：`src/server.js`
- 新建：`tests/server-1688.test.js`

**步骤：**

1. 先写独立服务端测试，覆盖 `/api/1688/token/exchange`、`token/refresh`、`connection/test`、类目、Schema、子 Schema、预检和任务 CRUD。
2. 测试注入 fake 1688 client，确认不会调用 ICBU client。
3. 运行 `node --test tests/server-1688.test.js`，确认路由缺失导致失败。
4. 在 `createServer` 依赖中新增独立 1688 依赖；只添加所需路由，不重排现有 ICBU/Obsidian 代码。
5. 归一化权限、Token 过期、SDK 未就绪和网络错误为明确中文诊断。
6. 运行该测试文件和 `tests/server.test.js`，预期通过且用户现有测试保持不变。

## Task 6：图片上传和安全发布路由

**文件：**

- 修改：`src/server.js`
- 修改：`tests/server-1688.test.js`

**步骤：**

1. 写失败测试覆盖图片格式、2 MB 上限、官方错误码 4/32/35/36 和安全响应。
2. 写失败测试覆盖发布路由默认禁用、能力门控未通过、任务版本冲突、Schema 哈希冲突和缺失字段。
3. 写失败测试证明一次点击最多一次 `alibaba.new.product.add`；重复和并发请求返回同一发布记录。
4. 写失败测试覆盖写成功、明确业务失败、Token 过期、图片失败和不确定超时。
5. 写失败测试证明超时后只能调用只读对账，不能第二次调用发布接口。
6. 最小实现图片和发布路由、全局 1688 写锁及恢复逻辑。
7. 运行 `node --test tests/server-1688.test.js tests/server.test.js`，预期通过。

## Task 7：独立左侧入口、配置和连接诊断 UI

**文件：**

- 修改：`public/index.html`
- 修改：`public/styles.css`（仅在现有类不足时增加 1688 页面所需样式）
- 修改：`public/app.js`
- 新建：`public/1688-publishing.js`
- 新建：`tests/1688-publishing-ui.test.js`
- 修改：`tests/server.test.js`（只增加静态页面契约断言）

**步骤：**

1. 写失败测试定义左侧“1688 自动发品”入口、独立页面容器和脚本加载。
2. 写失败测试定义独立 `1688-*` 浏览器存储键，证明不读取或覆盖 `ali-*` ICBU 键。
3. 写失败测试定义配置、授权、Token 刷新、只读连接诊断和明确权限提示。
4. 最小添加页面结构和控制器，复用现有视觉样式。
5. 官方 JS SDK 采用显式诊断桥接；测试以 fake SDK 注入，不在自动测试中加载网络脚本。
6. 运行 UI 测试和现有 `tests/obsidian-publishing-ui.test.js`，预期通过。

## Task 8：单商品编辑、图片、预览和预检 UI

**文件：**

- 修改：`public/1688-publishing.js`
- 修改：`public/index.html`
- 修改：`public/styles.css`（如有必要）
- 修改：`tests/1688-publishing-ui.test.js`

**步骤：**

1. 写失败测试定义类目搜索、Schema 加载、级联规则和必填字段呈现。
2. 写失败测试定义本地图片选择、上传进度、失败恢复和官方 URL 替换。
3. 写失败测试定义标题、属性、SKU、价格、库存、起订量、详情和图片的本地编辑模型。
4. 写失败测试定义商品卡片预览、接口请求摘要和缺失字段清单。
5. 实现最小 UI；遇到未知必填组件时显示阻塞原因。
6. 运行 UI 测试，预期全部通过。

## Task 9：确认发布、刷新恢复和审核状态 UI

**文件：**

- 修改：`public/1688-publishing.js`
- 修改：`tests/1688-publishing-ui.test.js`

**步骤：**

1. 写失败测试定义每张卡片只有一个“确认并发布当前这一件”按钮，未就绪时禁用并显示具体原因。
2. 写失败测试定义重复点击只发送一个请求，页面刷新后恢复发布记录。
3. 写失败测试定义超时进入“结果不确定，只读核验中”，不出现自动重发动作。
4. 写失败测试定义商品 ID、请求 ID、错误码、审核状态和核验状态展示。
5. 实现最小 UI 状态恢复和手动只读核验按钮。
6. 运行 UI 测试，预期全部通过。

## Task 10：安全回归和文档校准

**文件：**

- 修改：`docs/1688-api-research.md`（仅根据实现事实校准）
- 修改：`README.md`（增加入口和安全说明）
- 修改：`WORK_MACHINE_SETUP.md`（增加非敏感配置和凭据禁止事项）
- 新建或修改：相应安全回归测试

**步骤：**

1. 增加测试扫描任务序列化、错误响应和日志对象，确认不含凭据。
2. 增加测试证明现有 ICBU 路由、调用次数和前端行为不变。
3. 更新用户文档，明确默认写入关闭、没有沙箱、首次真实发布需要当前会话确认。
4. 运行定向测试集，预期全部通过。

## Task 11：最终验证

1. 运行 `npm test`，要求全部通过。
2. 运行 `git diff --check`，要求无错误。
3. 使用未占用端口启动本地工作台，调用健康页和 1688 页面静态资源，随后正常停止进程。
4. 检查 `git status --short`，确认原有用户修改和 `data/` 仍在，且没有凭据或临时文件进入 Git 状态。
5. 审查最终 diff，仅保留与 1688 模块直接相关的修改。
6. 使用 `superpowers:verification-before-completion` 复核所有完成声明。
7. 使用 `superpowers:finishing-a-development-branch` 完成分支交付说明；未经用户要求不提交、不合并、不清理 worktree。
