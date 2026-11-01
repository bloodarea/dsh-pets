# Spine 部件编辑器（单文件，本地用）

一个不用装任何依赖的网页小工具，用来**手动微调角色部件的摆放位置与 z 序**，并能预览动画。
产出直接回写 `model.json`，与我们的 spine-pack 流程兼容。

## 启动

三平台都是一条命令，**不需要 pip 安装任何依赖**（只用 Python 3 标准库）：

| 平台 | 命令 |
| --- | --- |
| Linux / macOS | `./tools/spine-part-editor/start.sh` |
| Windows | 双击 `tools\spine-part-editor\start.bat`，或命令行 `start.bat` |

脚本会：自动选空闲端口（默认 8123，被占用就往后找）→ 在**仓库根目录**起静态服务 →
打开浏览器。用 `--port 9000` 指定端口，`--no-browser` 只起服务。

等价的手工方式：

```bash
cd /home/dev/SourceCodeLibrary/Plugins/dsh-pets     # 必须在仓库根
python3 -m http.server 8123 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8123/tools/spine-part-editor/
```

> 为什么必须起服务：编辑器要 `fetch` 同仓库的 `assets/.../model.json`，
> 浏览器对 `file://` 的 fetch 一律拒绝，直接双击 html 会载入失败。

## 载入角色

| 方式 | 说明 |
| --- | --- |
| **载入仓库示例** | 一键读 `assets/characters/deepseek/spine/`（需上面的 http 服务） |
| **载入文件…** | 手动选三个文件：`model.json` + `model.atlas` + `model.png`（文件对话框里多选） |

也可以用 `legacy-views/` 下的三视图版本试玩（它带 slot attachment 时间线，能看转身）。

## 操作

| 动作 | 操作 |
| --- | --- |
| 选中部件 | 点击画布上的部件，或点右侧层级列表 |
| 移动 | 拖拽部件；或方向键微调（Shift ×10）；或直接改 X / Y 数值 |
| 调 z 序 | 列表每行的 `⤒ ↑ ↓ ⤓`；或键盘 `[` / `]` |
| 平移视图 | 按住空格拖拽（或中键拖拽） |
| 缩放视图 | 滚轮；`适配` 回到全图 |
| 撤销 | Ctrl+Z（最多 120 步） |
| 播放动画 | 顶部「动画」下拉选一段 → `▶ 播放` / `■ 停止`；空格也可播放/暂停 |
| 拖时间轴 | 直接拖动进度条定位到任意时刻（此时自动暂停） |
| 循环 / 速度 | `循环` 勾选；速度 0.25×–2× |
| 看骨骼轴心 | 勾「轴心」，选中部件后显示黄十字（改 pivot 是否合理就看它） |
| 隐藏部件 | 列表每行的 👁 / 🙈 图标；`H` 切换选中件；`全部显示` 一键恢复 |
| 隐藏的用途 | 排查遮挡关系（比如藏掉头发看身体接缝）、确认某部件是否多余 |

## 显示层（复选框，可叠加 / 只读调试）

顶部是一排**复选框**，勾哪个显示哪个，可以同时开多个：

| 复选框 | 显示什么 | 用来排查 |
| --- | --- | --- |
| **贴图** | 角色贴图本体（默认勾选） | 最终观感；**只有勾选它才能拖动部件** |
| **骨骼** | 父→子骨链 + 关节圆点 + 骨骼名；FK 蓝 / IK 琥珀，侧栏给数量图例 | 层级、轴心、IK 约束 |
| **权重** | 每个部件按归属骨骼着色的色块 + 骨骼名标签 + 图例 | 部件挂错骨、绑定归属 |
| **网格** | 网格细分 / 真实三角面 + 包围框；右下角图集 UV 预览（黄框=选中件） | 网格密度、UV 占位 |
| 表情 | 眨眼 / 口型 / 眉毛 / 四种预设的参数面板（放最后） | 表情槽位与参数范围 |

行为约定：

- **叠加时贴图自动压暗到 35%**，保证线框与色块读得清；全部关掉覆盖层就恢复 100%。
- **拖动只在「贴图」勾选时可用**；贴图关掉时画布只显示调试层，拖动会提示
  「未勾选贴图：当前只显示调试层，不能拖动部件」。平移/缩放不受限制。
- 拖动贴图后，骨骼、权重、网格**跟着一起动**——它们都从当前骨骼/附件位置实时计算，不是贴图烘死的。

补充说明：

- **IK 判定**：读 `skeleton.ik` 的 `bones`/`target`；deepseek 角色包没有 ik 约束，图例显示 `FK 12 / IK 0`。
- **权重**：本角色包是一部件一骨骼的刚性绑定（权重恒 1.0），颜色只表示归属；
  带网格权重（`vertices` 含权重）的包才有真正的热力分布。
- **表情**：扫描 slot/attachment 名里的 `eye|mouth|brow`；本包没有这些层时只给提示，
  眨眼参数退化为头部轻微形变。
- **网格**：有 `uvs + triangles` 画真实三角网格与顶点，否则画 8×8 细分示意。

## 图标集

界面上的图标是自绘的一套 16×16 SVG，风格统一（1.6 线宽、圆角端点、颜色跟随按钮文字），
全部是内联雪碧图，不依赖外部资源：

| 文件 | 作用 |
| --- | --- |
| `icons.js` | 定义 27 个图标符号（`symbol#i-*`）并注入文档；对外暴露 `spineIcon(name)` |
| `icons-preview.html` | 图标一览页（含 13/14/16/28px 缩放效果），改图标时先在这看 |

图标名单（spine 语义 + 编辑器操作）：

`bone` `joint` `mesh` `keyframe` `timeline` `layers` `physics` `layer-front` `layer-back`
`layer-up` `layer-down` `eye` `eye-off` `play` `pause` `stop` `loop` `open` `sample`
`save` `undo` `reset` `fit` `bounds` `pivot` `move` `trash`

新增图标：在 `icons.js` 的 `ICONS` 里加一条（`viewBox="0 0 16 16"`，只写内部路径），
然后在 `index.html` 里用 `<svg class="ic"><use href="#i-名字"></use></svg>`，
或直接调 `spineIcon("名字")` 生成字符串。

## 保存与回灌

点 **保存 JSON** 会下载 `model.json`。回灌流程：

```bash
# 1) 用下载的文件覆盖
cp ~/Downloads/model.json assets/characters/deepseek/spine/model.json

# 2) 重新打包图集（几何变了必须重打）
cd references/ref-sprite/game-asset-aesthetic-test/extensions/skills/game-asset-spine-cutout/assets/workspace
python scripts/spine-pack.py ../../../../../../dsh-pets/assets/characters/deepseek/spine --name model

# 3) 官方运行时校验
cd /tmp/spine-verify && node spine-verify.mjs /path/to/assets/characters/deepseek/spine model
```

保存只会写**骨骼位置**与**slots 顺序**，动画时间线原样保留。
（显隐只是编辑器里的预览开关，**不会**写进 JSON —— 需要真隐藏请把该 slot 的 alpha 设为 0。）

## 已知限制

- 只支持位置与绘制顺序，**不支持旋转/缩放/网格/权重**（要做这些得用 Spine 官方编辑器）；
- 动画只播放 `bones`（rotate/translate/scale）与 `slots.attachment` 时间线；`deform`、`color`、`physics` 不参与预览；
- 拖拽编辑的是 **setup pose**；如果当前有时间轴偏移，画面按动画姿势显示，拖拽后会回到 setup 手感，请注意先 `■ 停止`；
- 图集路径是相对的：示例按钮依赖 `../../assets/...` 这个位置关系。

## 为什么不用官方 Spine 编辑器

官方编辑器能做网格、权重、物理、缓动曲线，是精修的正路；但它需要付费授权。
这个工具解决的是"只想把部件摆正、把层级调对"的高频小事，零依赖、开箱即用。
