# 工作台快捷方式图标

- `workbench-icon.png`：生成的透明背景原图。
- `workbench-icon.ico`：Windows 多尺寸图标，包含 16、20、24、32、40、48、64、128、256 像素。
- 图标通过内置图像生成工具制作；ICO 只做格式和尺寸导出，未改变设计。
- 本机开始菜单快捷方式名称为「国际站运营工作台」；目标为系统 `cmd.exe`，通过参数 `/d /c ""<项目目录>\启动工作台.cmd""` 调用现有脚本，避免直接将脚本作为快捷方式目标。
- 快捷方式调用独立后台启动器，启动窗口会自动关闭；关闭浏览器不影响服务。需要退出时使用项目根目录的 `停止工作台.cmd`。不包含开机自启、异常自动重启或后台自动发布。
- 若旧的前台服务仍在运行，启动器会提示先完成操作并关闭旧启动窗口，不会强制结束进程或误报已转为后台。

## 原始生成提示词

Create one finished Windows desktop application icon, square 1024x1024. App: a local international trade product publishing workbench. Design a strong simple white shipping-carton outline with an integrated bold upward arrow, centered on a warm burnt-orange rounded square tile, matching a restrained orange-and-white operations dashboard. Flat vector-like geometry, precise thick strokes, generous internal padding, crisp silhouette legible at 16px, professional and understated. Very subtle tile depth only, no busy details, no thin lines, no photorealism. Transparent area outside the rounded square, no surrounding scene, no caption, no letters, no words, no watermarks, no Alibaba official logo. Only a single large icon occupying the canvas.
