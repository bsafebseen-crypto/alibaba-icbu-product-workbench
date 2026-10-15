# 上品 Agent Skills

这里保存本机两个已安装 Skill 的源码快照，同步日期为 2026-10-15。每个目录包含原始 `SKILL.md`、规则、输出模板、校验脚本、Agent 配置和测试，便于版本管理与换机恢复。

| Skill | 用途 | 入口 |
|---|---|---|
| `generate-alibaba-listings` | 根据同一产品图片和国际站 Excel 词表生成指定数量的英文发品方案，校验标题并按授权回写来源词表 | [SKILL.md](generate-alibaba-listings/SKILL.md) |
| `generate-1688-listings` | 根据产品图片生成 1688 中文标题、SPU/SKU、属性及规格预测，保存到 Obsidian | [SKILL.md](generate-1688-listings/SKILL.md) |

## 使用与恢复

在支持 Agent Skills 的环境中，通过该环境的 Skill 安装或管理工具安装相应子目录，再按其 `SKILL.md` 使用。本机共享安装位置为 `C:/Users/zhanghuaiming/.agents/skills/`，仓库副本与已安装副本分别保存；更新其中一份不会自动同步另一份。

Skill 内保留了本机词库和 Obsidian 的默认路径。换机使用时，需要准备相应目录或在任务中提供新的路径。关键词 Excel、产品图片、生成的发品文件和本机凭证不包含在这些目录中。

国际站 Skill 的 Excel 扫描和回写依赖 `spreadsheets:Spreadsheets` 提供的官方 `@oai/artifact-tool` 运行时；它不是工作台 `npm ci` 安装的依赖。按 Skill 中的工作目录步骤加载运行时后，再执行工作簿操作。1688 Skill 的校验脚本只使用 Node.js 内置模块。

这些 Skill 由 Agent 按任务执行，不会因启动工作台而自动运行；内容生成和阿里商品发布是分别执行的步骤。

## 验证

在仓库根目录运行 `npm test`，会同时运行工作台和这两个 Skill 的单元测试。也可以单独运行：

```powershell
node --test skills/generate-alibaba-listings/tests/workbook-tools.test.mjs
node --test skills/generate-1688-listings/tests/listing-tools.test.mjs
```

这些测试使用内存数据和临时文件，不操作真实词库或调用阿里发布接口。
