# 工作机接手指南

本指南用于在另一台 Windows 工作机上克隆、验证、启动并继续开发国际站自动上品工作台。

## 1. 环境要求

- Git
- Node.js 20 或更高版本（自带 npm）
- 能访问 GitHub 和 npm 软件源的网络
- 已登录有权访问私有仓库 `bsafebseen-crypto/alibaba-icbu-product-workbench` 的 GitHub 工作账号

Python 目前不是项目依赖。

## 2. 克隆项目

```powershell
git clone https://github.com/bsafebseen-crypto/alibaba-icbu-product-workbench.git
cd alibaba-icbu-product-workbench
```

私有仓库首次克隆时，Git 可能打开浏览器要求登录 GitHub。请使用工作账号完成授权，不要输入 GitHub 账号密码作为 Git 密码。

## 3. 安装并验证

```powershell
node --version
npm ci
npm test
```

`node_modules/` 不上传 GitHub。`npm ci` 会依据已提交的 `package-lock.json` 在工作机还原锁定的依赖版本，这是 Node.js 项目的标准换机方式。

## 4. 启动工作台

可以双击项目根目录的 `启动工作台.cmd`。脚本检测到缺少依赖时会自动执行 `npm ci`，随后启动独立后台服务，确认就绪后打开浏览器。启动窗口会自动关闭，不影响后台服务；关闭浏览器也不会停止工作台。

需要停止后台时双击 `停止工作台.cmd` 并确认。正在写入商品时会拒绝停止；不会强制结束进程，也不会自动重发商品。

也可以运行：

```powershell
npm start
```

然后访问 `http://127.0.0.1:54025/`。`npm start` 为前台开发模式，需要保留终端；服务只监听本机地址。

## 5. 需要重新配置的本机内容

为了避免泄露，以下内容不会上传 GitHub，需要在工作机重新填写或手动准备：

- AI API Key
- 阿里 App Secret、Access Token 和 Refresh Token
- 1688 国内站独立的 App Secret、Access Token 和 Refresh Token
- 浏览器本地存储
- `data/tasks/` 中的本地任务
- 商品图片、关键词表和其他本地素材
- `.env`、日志和临时文件

不要把上述内容提交到 Git。

## 6. 继续开发

在 Codex 中打开克隆后的项目目录即可。根目录的 `AGENTS.md` 记录了项目结构、测试方式、阿里接口安全边界和当前下一步，开发前应先阅读它。

开始工作前同步代码：

```powershell
git pull --ff-only
npm ci
npm test
```

修改后至少运行 `npm test`。阿里商品草稿、新增、修改或正式发布接口尚未开放；继续接入前必须保留逐件人工确认，并遵守 `AGENTS.md` 的安全红线。

1688 模块的真实商品写入也默认关闭。新工作机先完成只读连接、类目 Schema、本地预检和 mock 测试；只有用户明确同意首次单商品联调时，才在当前 PowerShell 会话临时设置 `WORKBENCH_1688_ALLOW_WRITES=1`。不要把该开关、Secret 或 Token 写入仓库、启动脚本、日志或任务 JSON。
