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

## 查看模式（只读调试）

顶部模式切换，都是**只看不改**：

| 模式 | 显示什么 | 用来排查 |
| --- | --- | --- |
| **贴图** | 原始渲染（默认） | 最终观感 |
| **骨骼** | 骨链（父→子）+ 关节圆点 + 骨骼名；**FK 蓝色 / IK 琥珀色**，侧栏给数量图例 | 骨骼层级对不对、轴心在哪、有没有 IK 约束 |
| **权重** | 每个部件按「归属骨骼」着色的半透明色块 + 骨骼名标签 + 单色图例 | 部件挂错骨、绑定归属混乱 |
| **表情** | 眨眼 / 口型 / 眉毛 / 四种表情预设的参数面板 | 表情槽位是否齐、参数范围是否合适 |
| **网格** | 每个部件的网格细分 + 包围框；右下角**图集 UV 预览**（黄框=选中部件区域） | 网格密度、UV 占位、切图偏移 |

补充说明：

- **IK 判定**：读 `skeleton.ik`（Spine 原生 ik 约束）里的 `bones` 与 `target`；
  当前 deepseek 角色包没有 ik 约束，所以图例显示 `FK 12 / IK 0`。
- **权重的诚实说明**：本角色包是「一部件一骨骼的刚性绑定」，每件权重恒为 1.0，
  颜色只表示归属；带网格权重（`vertices` 含权重）的角色包才能看到真正的热力分布。
- **表情的诚实说明**：面板会扫描 slot/attachment 名里的 `eye|mouth|brow` 关键字；
  本角色包没有这些层，所以只会给出提示，并且眨眼参数退化为头部的轻微形变。
- **网格**：有 `uvs + triangles` 时画真实三角网格与顶点；没有时画 8×8 细分示意。

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
