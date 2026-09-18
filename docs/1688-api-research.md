# 1688 开放平台商品接口研究

查询日期：2026-09-16

范围：向商家自己的 1688 国内站店铺发布和管理商品。本文不讨论把 1688 货源铺到其他平台，也不采用网页模拟、浏览器脚本、内部接口或抓包接口。

## 结论摘要

1688 当前仍公开提供商品创建、编辑、增量编辑、价格、库存、重发、重新上架、下架/过期和删除等开放接口。推荐的新发布链路属于“新版商品管理解决方案”，分为：

- 商家自用版：面向有系统对接能力的诚信通商家，仅限自有系统和自有店铺；官方方案详情显示可自动通过订购。
- 服务商版：面向为多个授权商家开发商品工具的软件开发商/服务市场应用，需按服务商身份申请。
- 新版电商 ERP 等其他方案：面向相应服务商或特定业务身份，不应作为普通商家自用的默认申请路径。

因此，“自动发布几百个商品”在技术上存在官方 API 路径，但不等于账号可无限制自动发布。必须同时满足应用方案、诚信通身份、店铺和类目资质、当日发品规则、图片限额、API 限流和风控要求。第一版应先完成单商品闭环，不能直接开启批量写入。

官方没有在本次已查资料中提供明确的商品发布沙箱、测试账号或 `validate-only/dry-run` 接口。`getSchema/getSubSchema` 是规则读取接口，不是官方提交预检接口。

## 官方资料入口

- [新版商品管理解决方案（商家自用版）](https://open.1688.com/solution/solutionDetail.htm?solutionKey=1671675923686)
- [新版商品管理解决方案（服务商版）](https://open.1688.com/solution/solutionDetail.htm?solutionKey=1668600046917)
- [1688 开放平台 API 列表](https://open.1688.com/api/apidoclist.htm)
- API 请求形式：`https://gw.open.1688.com/openapi/param2/{version}/{namespace}/{name}/{APPKEY}`，请求内容类型为 `application/x-www-form-urlencoded`。

接口文档链接均指向 1688 官方开放平台。文档页面的结构化数据是本报告参数和权限结论的主要依据。

## 身份、应用和授权

### 应用与方案

商家自用版官方说明：适用于有系统对接能力的诚信通商家，对接开发商品相关功能，仅限商家自用，无需上架到服务市场售卖。方案使用新版 Schema 商品模型，支持商品发布和修改等功能。

服务商版官方说明：适用于为商家开发商品管理工具的服务商，可开发授权商家的商品发布和修改功能。该身份与商家自用版不同，不能混用。

### OAuth

官方 API 目录仍提供 `system.oauth2:getToken-1`，接口本身无需用户授权令牌和签名，输入、输出以通用 Map 表示。公开详情页没有完整展示授权码换 Token 和 Refresh Token 的全部字段，因此以下内容必须在实际应用控制台继续核实：

- 授权地址和登记回调地址。
- 授权码有效期。
- `access_token` 有效期。
- `refresh_token` 有效期及是否轮换。
- 当前应用实际获得的 API 权限包。

实现中不得沿用国际站 ICBU 的 `open-api.alibaba.com` Token 或存储键。1688 OAuth、网关和 Token 必须独立。

官方入口：[getToken](https://open.1688.com/api/apidocdetail.htm?id=system.oauth2:getToken-1)

## 第一版准备实现的接口

### 1. 搜索类目

- 官方名称：根据关键字搜索类目
- method：`alibaba.category.searchByKeyword`
- namespace/version：`com.alibaba.product / 1`
- 官方文档：[链接](https://open.1688.com/api/apidocdetail.htm?id=com.alibaba.product:alibaba.category.searchByKeyword-1)
- 请求：`keyword:String`，必填。
- 返回：`products: CategoryInfo[]`、`success`、`errorCode`、`errorMsg`。
- 权限：需要 Access Token；需要签名；商家自用版支持。
- 写入：否。
- 错误：官方详情只列通用“查询失败”，应保留原始业务码并转成中文诊断。
- 幂等：只读，天然可重试；需受超时和限流控制。
- 发布后核验：不适用。

### 2. 查询类目

- 官方名称：根据类目 Id 查询类目
- method：`alibaba.category.get`
- namespace/version：`com.alibaba.product / 1`
- 官方文档：[链接](https://open.1688.com/api/apidocdetail.htm?id=com.alibaba.product:alibaba.category.get-1)
- 请求：`categoryID:Long`，必填，文档要求大于等于 0。
- 返回：`categoryInfo: CategoryInfo[]`、`succes`（官方字段拼写）、`errorCode`、`errorMsg`。类目返回的 `categoryType` 用于映射发布 `scene`。
- 权限：不需要 Access Token；需要签名；商家自用版支持。
- 写入：否。
- 错误：官方详情未列专用错误表。
- 幂等：只读，可安全重试。
- 发布后核验：不适用。

### 3. 查询叶子类目属性（辅助诊断）

- 官方名称：获取叶子类目属性
- method：`alibaba.category.attribute.get`
- namespace/version：`com.alibaba.product / 1`
- 官方文档：[链接](https://open.1688.com/api/apidocdetail.htm?id=com.alibaba.product:alibaba.category.attribute.get-1)
- 请求：`categoryID:Long` 必填、`webSite:String` 必填且取 `1688`、`scene:String` 可选。
- 返回：`attributes: AttributeInfo[]`、层级属性关系、`success/errorCode/errorMsg`。
- 权限：需要 Access Token 和签名。该接口不在商家自用版的结构化方案列表中，因此只作为可选诊断，不能作为新版发布的硬依赖；核心规则以 `getSchema` 为准。
- 写入：否。
- 错误：`500_2` 表示类目属性正在准备，官方建议等待 1–3 秒后重试。
- 幂等：只读，可按官方建议有限重试。
- 发布后核验：不适用。

### 4. 获取商品发布规则和详情

- 官方名称：获取商品发布规则和详情
- method：`alibaba.new.product.getSchema`
- namespace/version：`com.alibaba.product / 1`
- 官方文档：[链接](https://open.1688.com/api/apidocdetail.htm?id=com.alibaba.product:alibaba.new.product.getSchema-1)
- 请求：
  - `catId:Long` 可选。
  - `scene:String` 必填。
  - `offerId:Long` 可选，用于编辑场景。
  - `bizParam` 可选；工业品场景的 `industryCategoryId` 按文档要求填写，且可不传 `catId`。
- `scene` 映射：`categoryType=1 -> cbu`；`2 -> industry`；`3 -> popular`；加工定制使用 `processing`。
- 返回：`result` 中包含 `success:Boolean`、`bizCode:String`、`bizMsg:String`、`bizData:String`；`bizData` 是动态 Schema JSON。
- 权限：Access Token、签名和新版商品管理方案；商家自用版支持。
- 写入：否。
- 错误：接口详情未列固定错误码；应展示 `bizCode/bizMsg`。方案文档另列大量发布业务校验码，规则会随 Schema 变化。
- 幂等：只读，可重试；应保存 Schema 哈希并在发布前检查变化。
- 发布后核验：可用 `offerId` 读取编辑规则，但商品最终状态仍由商品查询接口核验。

官方方案特别要求：每天定期拉取商家对应类目的规则并检测差异；本地数据必须动态映射到返回 JSON，不能使用固定参数模型。

### 5. 获取级联子组件规则

- 官方名称：获取商品发布级联子组件规则
- method：`alibaba.new.product.getSubSchema`
- namespace/version：`com.alibaba.product / 1`
- 官方文档：[链接](https://open.1688.com/api/apidocdetail.htm?id=com.alibaba.product:alibaba.new.product.getSubSchema-1)
- 请求：`catId:String` 必填、`scene:String` 可选且默认 `market`、`dataBody:String` 必填、`bizParam` 可选。
- 返回：`success`、`bizCode`、`bizMsg`、`bizData:String`。
- 权限：Access Token、签名和新版商品管理方案；商家自用版支持。
- 写入：否。
- 错误：详情页仅出现占位错误项，实际以 `bizCode/bizMsg` 为准。
- 幂等：只读，可重试。
- 发布后核验：不适用。

### 6. 上传图片

- 官方名称：上传图片
- method：`alibaba.photobank.photo.add`
- namespace/version：`com.alibaba.product / 1`
- 官方文档：[链接](https://open.1688.com/api/apidocdetail.htm?id=com.alibaba.product:alibaba.photobank.photo.add-1)
- 请求：`albumID:Long`（1688 使用时需要有效相册）、`name:String` 必填且最多 30 个中文字符、`description` 可选、`drawTxt` 可选、`imageBytes:byte[]`、`webSite:String` 必填且取 `1688`。
- 返回：`image: ResponseDomain`、`errorCode`、`errorMsg`。
- 权限：Access Token、签名；商家自用版支持；上传需要诚信通身份。
- 写入：是，写入官方图片空间，但不是商品发布。
- 错误码：
  - `1` 参数非法。
  - `2` 禁止操作。
  - `4` 非诚信通会员，不能上传。
  - `10/11/13/14/15` 相册数量、相册不存在、相册已满、扩展空间已满或密码错误。
  - `31` 用户空间已满。
  - `32` 图片格式不支持；单图不得超过 2 MB，支持 jpg/jpeg/gif/bmp/png，不支持透明 PNG 的透明效果。
  - `35` 单商家每日图片上传超过 5000 张。
  - `36` 单用户超过 5 QPS。
- 幂等：官方未提供幂等键。上传失败可由用户明确重试；超时后应先查图片列表或由用户确认，避免重复上传。
- 发布后核验：使用返回的官方 URL；商品核验时比对主图/详情图引用。

### 7. 发布商品

- 官方名称：新版商品发布
- method：`alibaba.new.product.add`
- namespace/version：`com.alibaba.product / 1`
- 官方文档：[链接](https://open.1688.com/api/apidocdetail.htm?id=com.alibaba.product:alibaba.new.product.add-1)
- 请求：
  - `catId:Long` 可选。
  - `scene:String` 必填。
  - `dataBody:String` 必填；包含从 Schema 原样沿用的 `global` 和动态组装的 `formValues`。
  - `bizParam` 可选；工业品场景按规则填写。
  - `productSourceChannels:String` 可选。
- 返回：`result.success`、`result.bizCode`、`result.bizMsg`、`result.bizData.dataJson`。官方示例中的 `dataJson` 包含 `itemId`、`qualityScore`、`categoryId`、`offerStatus`。
- 权限：Access Token、签名、新版商品管理方案、诚信通商家及店铺/类目资质；商家自用版支持。
- 写入：是，会产生真实商品。
- 错误：接口详情未维护固定错误表；方案文档列有大量 `PUB_BIZCHECK_*`、`CHK_*` 校验码。例如非叶子类目、禁止上架、未开通旺铺、账号处罚、类目资质缺失、当日发品数量超限、图片/标题/SKU/价格/库存/物流错误等。实现必须保存并展示官方 `bizCode/bizMsg`，不能只显示 HTTP 错误。
- 幂等：未发现官方幂等参数。客户端必须以规范化请求指纹、唯一货号、持久化 `publishing` 状态和全局写锁实现防重复。
- 发布后核验：必须通过下述商品查询接口核验。HTTP 200 或 `result.success=true` 仍不能代替只读对账。

官方方案还要求前端加载 `https://o.alicdn.com/fuwu-assets/alife-open-sdk/index.js`，以 `appKey` 和与后台一致的 `appName` 初始化 `window.__1688_OPEN_SDK_CONFIG`。真实发布就绪前必须完成该 SDK 的账号环境验证。

### 8. 按条件查询商品

- 官方名称：获取商品列表
- method：`alibaba.product.list.get`
- namespace/version：`com.alibaba.product / 1`
- 官方文档：[链接](https://open.1688.com/api/apidocdetail.htm?id=com.alibaba.product:alibaba.product.list.get-1)
- 请求：`pageNo`、`pageSize` 必填，页大小最大 20；支持 `statusList`、`categoryId`、修改/发布时间窗口、`subjectKey`、`cargoNumber`、`productIds` 等过滤。
- 返回：`result: productInfoListResult`、`success`、`code`、`message`。
- 权限：Access Token 和签名；商家自用版支持。
- 写入：否。
- 错误：详情页未列专用错误表。
- 幂等：只读，可按退避计划重试。
- 发布后核验：发布超时且没有商品 ID 时，用唯一货号、类目和窄发布时间窗口查询；只有唯一匹配才能继续记录商品 ID。

### 9. 查询单个商品

- 官方名称：获取商品
- method：`alibaba.product.get`
- namespace/version：`com.alibaba.product / 1`
- 官方文档：[链接](https://open.1688.com/api/apidocdetail.htm?id=com.alibaba.product:alibaba.product.get-1)
- 请求：`productID:Long` 必填、`webSite:String` 可选、`scene:String` 可选。
- 返回：`productInfo`、业务分组、创建/修改/重发/审核/过期时间及 `errMsg`。
- 权限：Access Token、签名；只能获取当前授权用户自己的商品；商家自用版支持。
- 写入：否。
- 错误：详情页未列专用错误表。
- 幂等：只读，可按退避计划重试。
- 发布后核验：通过商品 ID 查询标题、货号、类目、状态和关键字段，保存审核状态及核验时间。

### 10. 按状态查询商品

- 官方名称：根据状态查询商品
- method：`alibaba.product.getByStatus`
- namespace/version：`com.alibaba.product / 1`
- 官方文档：[链接](https://open.1688.com/api/apidocdetail.htm?id=com.alibaba.product:alibaba.product.getByStatus-1)
- 请求：`pageNo`、`pageSize`、`statusList:String[]` 均必填。
- 返回：商品列表结果、`success/errorCode/errorMessage`。
- 权限：Access Token 和签名。
- 写入：否。
- 错误：详情页未列专用错误表。
- 幂等：只读。
- 发布后核验：作为审核中、已上架或被退回状态的辅助查询，不能代替按商品 ID/唯一货号精确对账。

## 后续生命周期接口

以下接口官方仍提供，但不进入第一版真实写入 UI：

- `alibaba.new.product.edit`：新版全量编辑，真实写入；商家自用版支持。
- `product.increment.editInfo`：新版增量编辑，真实写入；只提交需要更新的字段；免费会员限制以接口返回为准。
- `alibaba.product.modifyStock`：修改库存，真实写入。
- `alibaba.product.price.update`：修改价格，真实写入；官方列有 `500_1`、`500_100` 等错误。
- `alibaba.product.republish`：重新上架未上架商品，真实写入；官方说明会员每天最多处理 400 条，并有特殊商品限制。
- `alibaba.product.repost`：重发商品，真实写入；官方说明每天最多 400 条。
- `alibaba.product.expire`：使商品过期/下架，真实写入。
- `alibaba.product.delete`：移入回收站，真实写入。

这些接口未来必须各自增加确认、指纹、防重复、只读核验和独立测试，不能因为发布链路已接通就自动开放。

## 类目、SKU、价格、库存、物流和详情

新版方案不再以固定的一组发布参数表达这些信息，而是由 Schema 字段动态定义。官方 Schema 文档显示的组件包括：

- 类目属性与自定义属性：`catProp/cbuProp`。
- 主图和 SKU 图：`primaryPicture`、`saleProp`、`sku_picture_url` 等。
- SKU：规格属性、价格、可售库存、货号和上架状态。
- 价格和起订量：`quotationType`、`priceRange`、`beginAmount`、加工定制价格组件。
- 库存：SKU 可售数量、总库存和扣减方式。
- 物流：运费模板、发货地址、重量、体积、官方物流 SKU 信息。
- 详情：`description.detailList`，可包含图文详情、尺寸表等由 Schema 要求的区块。

必须根据当前 Schema 的 `required`、字段类型、枚举、最大数量、数值范围和级联规则组装，不能把官方示例值作为通用值。

## 频率、数量、幂等与风控

已确认的明确限制：

- 图片上传：单用户 5 QPS，单商家每天最多 5000 张，单图最大 2 MB。
- 商品列表查询：每页最大 20。
- 重发/重新上架：官方相关文档说明每天最多 400 条。
- 商品编辑：部分旧接口文档说明单商品每天最多编辑 30 次；新版接口应以实际方案和返回码为准。
- 新建商品：官方方案错误码明确存在“超过当天发布商品数量限制”，但未给出对所有账号统一适用的固定数值。额度会受账号、店铺和平台规则影响，不能写死为某个数字。

未发现商品发布接口的官方幂等键。自动化必须自行实现：

- 单商品唯一货号。
- 规范化请求 SHA-256 指纹。
- 写前持久化状态。
- 一次确认最多一次写调用。
- 超时后仅只读核验。
- 页面刷新和服务重启后仍保留“写机会已消耗”状态。

平台风控和类目规则会变化。官方方案明确要求定期拉取 Schema 并检测差异；开发者不得通过批量高频调用绕过限流、当日额度或账号处罚。

## 沙箱和预检

本次未在官方方案和接口详情中发现：

- 商品发布沙箱网关。
- 官方公开测试店铺。
- 只校验不发布的 `dry-run` 参数或独立接口。
- 商品发布幂等键。

因此开发与自动测试全部使用 mock/fake。真实账号联调的安全顺序应为：只读授权、类目、Schema、图片空间只读诊断、本地预检、人工核对请求摘要；第一次真实发布必须由用户在当前会话再次明确确认。

## 当前账号尚需确认的条件

尚不能仅凭公开文档确认当前账号已具备发布权限。需要账号侧提供或确认：

1. 1688 开放平台应用及其 App Key、App Secret、应用名称、回调地址。
2. 已订购“新版商品管理解决方案（商家自用版）”。
3. 被授权账号是有效诚信通商家，并拥有目标类目的经营和资质权限。
4. Access Token 和 Refresh Token 可用于只读连接验证。
5. 官方前端 JS SDK 可在工作台实际来源下初始化；如要求 HTTPS 登记域名，需要完成登记。
6. 店铺当前没有处罚、旺铺未开通、类目资质、图片空间、每日发品额度等阻塞。

这些资料只用于本机连接验证，不写入 Git、任务 JSON或日志。

## 对用户提供材料的判断

用户提供的说明对接口名称和方案方向帮助很大，以下线索已由官方资料核实：新版商家自用方案、动态 Schema、图片银行、新版发布、编辑、库存、价格、重发和商品查询。

需要修正的部分：

- `product.asyncQueryInfo.getInfo` 的官方描述偏向品牌、类目和标题等异步辅助信息，不能直接定义为商品审核状态接口。
- OAuth 具体地址、字段和权限包不能仅依据二手说明，必须结合当前应用控制台验证。
- 网页自动化/RPA 不属于可接受的兜底方案。
- “支持批量发布”描述的是方案能力，不表示当前账号没有当日额度、QPS、资质和风控限制。
