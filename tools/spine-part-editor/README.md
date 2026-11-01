# Spine 部件编辑器（零依赖，本地用）

一个不用装任何依赖的网页小工具，用来**手动微调角色部件的摆放（位置 / 旋转 / 缩放）与绘制顺序**，
并能在同一页里**预览动画、看骨骼与 IK、看网格与权重**。产出是打过补丁的 `model.json`，
与 spine-pack 流程兼容。

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

> 为什么必须起服务：编辑器要 `fetch` 同仓库的 `assets/.../model.json` 与图集图片，
> 浏览器对 `file://` 的 fetch 一律拒绝，直接双击 html 会载入失败。

## 载入

| 方式 | 说明 |
| --- | --- |
| **「示例 ▾」→ deepseek 女仆** | 一键读 `assets/characters/deepseek/spine/`（需上面的 http 服务） |
| **「示例 ▾」→ 测试样张** | 内置 fixtures（region / 刚性 mesh / 加权 mesh / 一骨 IK / 二骨 IK …），不依赖外部文件，适合验证渲染 |
| **载入文件…** | 手动选三个文件：`model.json` + `xxx.atlas` + 图集图片（多选；图片名要和 atlas 里的 page 名一致，多页图集要选齐所有页） |
| **拖入画布** | 把上面这组文件一起拖进画布，等同「载入文件…」 |
| **`?rig=<同源相对路径>`** | **开发用**：地址栏追加 `?rig=references/spine-rigs/spineboy-pro-42/spineboy-pro.json`，直接载入同目录的 `<同名>.atlas` 与图集图片。缺图集 / 缺图 / 版本不符都给可读错误（并把试过的路径列出来）。 |

载入是**校验后再提交**：新文件解析失败时**保留原来的模型**，画布不闪成空白，错误写在提示条与调试面板里。

## 能力

| 能力 | 状态 |
| --- | --- |
| region 附件（含 trim / rotate 90·180·270 / atlas `scale`） | ✅ 整四边形 affine 绘制 |
| 刚性 mesh | ✅ 逐三角 `clip + setTransform + drawImage`，顶点随骨变换 |
| 加权 mesh（多骨影响） | ✅ 顶点按权重蒙皮；权重着色按面内重心插值（有渐变，不是整块色） |
| IK 约束（一骨 / 二骨，Normal inherit、均匀缩放、无 shear） | ✅ 求值并画在骨骼层；不满足前提的约束显式标「受限 / 未求值」+ 原因 |
| 动画预览（bones rotate / translate / scale、slots attachment、ik 时间线） | ✅ 播放 / 暂停 / 循环 / 倍速 / 拖时间轴 |
| 摆位编辑 + 撤销 + 导出补丁 | ✅ 位置、旋转、缩放、z 序 |
| 网格层 / 权重层 / 骨骼层 / UV 预览 | ✅ 见下 |

## 界面

上面两行工具条（文件与视图 / 动画）、再一行显示层，中间画布（棋盘格），右侧 320px 栏：

1. **部件列表**：按绘制顺序倒序（最上层在最前），可搜索（部件名 / 附件名 / 骨名），每行可点眼睛隐藏；
2. **选中**：绑定骨、附件类型与顶点/三角数、可编辑性、X/Y、旋转（数值 + 滑杆）、缩放 X/Y、层级四键、恢复该部件、多骨影响列表；
3. **调试**（折叠）：骨骼 / IK、网格、权重、表情、未求值明细；
4. **状态脚注**：是否有未保存改动 · 未求值项数 · 渲染器。

窄屏（< 960px）右栏变抽屉，用工具条右侧的「面板」按钮开合。

## 显示层

| 复选框 | 显示什么 | 用来排查 |
| --- | --- | --- |
| **贴图** | 角色贴图本体（默认勾） | 最终观感 |
| **骨骼** | 父→子骨链 + 关节圆点 + 骨名；FK 蓝、IK 琥珀、IK target 红色十字 + 约束名 | 层级、轴心、IK 链条与 target |
| **网格** | 真实三角面 + 顶点 + hull 轮廓（region 只画 2 个三角 + 轮廓）；右下角图集 UV 预览（黄框=选中件的图集区域） | 网格密度、UV 映射 |
| **权重** | 按骨配色的顶点混合色（面内渐变）；「权重配色」可切「选中骨热力」看单骨权重 0..1 | 挂错骨、权重断层 |
| 吸附 | 拖动取整到 1 个单位（默认关） | 对齐 |
| 贴图强度 | 贴图不透明度（开调试层时自动降到 35%） | 看穿贴图 |

- 叠加调试层时贴图自动压暗（35%），关掉覆盖层恢复 100%；也可以手动拖强度。
- **贴图开关只影响显示**，不影响能否选中 / 拖动部件；但四层全关时画布显示
  「未显示任何内容 [恢复贴图]」，此时不响应画布拾取（列表与检查器照常可用）。
- 半透明贴图走「每个附件先以不透明画到离屏层、再整体合成」，避免叠加层下出现深色三角边。

## 快捷键

| 键 | 作用 |
| --- | --- |
| 拖动 / 中键拖动 | 移动部件 / 平移视图 |
| **Space（按住）** | 临时切到平移（**不播放动画**） |
| `V` | 移动工具 |
| `P` | 播放 / 暂停（播放已从 Space 挪到 P，按钮与帮助浮层都标了） |
| `F` / `Shift`+`F` | 适配全部 / 只适配选中件 |
| 方向键 / `Shift`+方向键 | 选中骨移动 1 / 10 个单位（父骨局部坐标） |
| `[` / `]` | 层级下移 / 上移 |
| `H` | 显隐选中件 |
| `Ctrl`/`⌘` + `Z` | 撤销（最多 120 步；一次拖动只算一条） |
| `+` / `-`、滚轮 | 缩放 |
| `Esc` | 取消正在进行的拖动（回滚）/ 清选择 / 关帮助 |
| `?` | 帮助浮层（含全部键位） |

输入框 / 下拉框聚焦时以上的单键都不劫持（在搜索框里敲 `f` 不会触发适配）。

## 编辑与撤销

- 可编辑：X / Y（父骨局部位移）、旋转（-180..180，数值 + 滑杆）、缩放 X/Y、z 序、显隐、锁定。
- 拖动只改 X / Y；旋转与缩放用检查器，同样写父骨局部值，撤销覆盖。
- **加权 mesh 的位置只读**（多骨控制，改位置无意义），**锁定的部件**、**IK 控制的骨**、
  **动画预览中**都会被拒绝并给出原因。
- 一次手势 = 一条撤销；拖动中按 `Esc` 回滚；「恢复该部件」把它自己的变换恢复到载入时的值。
- 显隐与锁定**只影响查看器**，不写进 JSON。

## 动画

- 「动画」下拉选一段 → `播放 P` / `暂停` / `回到开头` / `循环` / `0.25×–2×` / 拖时间轴。
- 预览动画时**禁用摆位**（状态栏与检查器写明「先点绑定姿态」），点 `绑定姿态` 回到 setup pose。
- 时长由 core 解析出的 track 决定；像 spineboy 的 `aim`（只有单帧关键帧）时长为 0，时间轴会禁用——这是数据本身的样子。

## 导出与回灌

点 **导出 JSON** 会下载打过补丁的 `model.json`：

- 只写**真正改过的骨骼字段**（`x` / `y` / `rotation` / `scaleX` / `scaleY`，只补有变化的键）；
- `slots` 顺序按当前层级重排，每项基于 `{...原始 slot}`（不重建、不四舍五入其它字段）；
- 动画、约束、skins 等其它内容**原样保留**。

回灌流程：

```bash
# 1) 用下载的文件覆盖
cp ~/Downloads/model.json assets/characters/deepseek/spine/model.json

# 2) 重新打包图集（几何变了必须重打）
cd references/ref-sprite/game-asset-aesthetic-test/extensions/skills/game-asset-spine-cutout/assets/workspace
python scripts/spine-pack.py ../../../../../../dsh-pets/assets/characters/deepseek/spine --name model

# 3) 官方运行时校验
cd /tmp/spine-verify && node spine-verify.mjs /path/to/assets/characters/deepseek/spine model
```

> 导出的是**运行时 JSON**，不是 Spine 工程文件：不能还原 `.spine` 源工程，也不做二进制 `.skel` 导出。

## 调试面板 / `window.__spineEditor`

调试分组里是只读诊断：骨骼 / IK 数量与约束名、网格附件清单（顶点 / 三角 / 是否加权）、
权重图例（只列实际用到的骨），以及**「未求值 / 诊断明细」**逐条列 `code + 路径 + 原因`。
标题右侧的数字 = 「部分预览 N 项未求值」里的 N（按**约束 / 附件 / 骨 / 特性**去重计数，不是 issue 条数）。

页面还挂了一个**只读调试句柄** `window.__spineEditor`（`state` / `core` / `frame()` / `renderer()` /
`hitTest()` / `render()` / `fitView()` / `loadRig()` / `exportJson()`），给本地校验与自动化断言用。
**它不是公开 API**，随时可能改，不要在业务代码里依赖。

## 已知限制

- **不做时间线编辑**：动画只能看，不能改关键帧、不能加轨道。
- **不做二进制导出**，**不做 `.spine` 源工程往返**；导出的是运行时 JSON 补丁。
- **transform / path / physics 约束不求值**，`deform` 形变、slot 颜色、`drawOrder` 时间线也不参与预览；
  这些都会在「部分预览」里点名（spineboy 的 8 个 transform 约束、deform、slotColor 就是这种情况）。
- **`inherit` 只支持 `normal` 与 `onlyTranslation`**；`noRotationOrReflection` 等按 `normal` 预览并告警。
- **IK 只支持一骨 / 二骨、Normal inherit、均匀缩放、无 shear** 的子集；不满足时保留 FK 并标「受限 / 未求值」。
- **多页图集只载入第 1 页**（其余页会提示；UV 预览也只看第 1 页）。
- `sequence` 附件、`clipping`、`boundingbox` 跳过并告警；linkedmesh 的少数边界情况未逐一验证。
- 渲染是 **Canvas2D**：mesh 逐三角 `clip + affine drawImage`，共享边可能有 ≤1 设备像素的抗锯齿细线，
  **不承诺与 GPU 运行时逐像素一致**（官方运行时是 GPU 批处理 + 纹理过滤，边缘与 mipmap 行为不同）。
- 图集路径是相对的：示例按钮依赖 `../../assets/...` 这个位置关系；`?rig=` 先按**站点根相对路径**找（`/references/...`），找不到再按页面相对路径找，失败时把两条都列出来。
- 官方编辑器的工程流程（`.spine` 导入导出、动画编辑、物理）**未测，也不在本工具范围**。

## 自测

起服务后打开：

```
http://127.0.0.1:8123/tools/spine-part-editor/selftest.html
```

页面跑 612 条断言（解析 / 矩阵 / IK oracle / 蒙皮 / 边界用例 / 退化数据），
结果在 `window.__selftestResult`（`failed === 0` 为通过）。回归截图放在 `output/review/t4/`（gitignore）。

## 图标集

界面上的图标是自绘的 16×16 SVG（1.6 线宽、圆角端点、颜色跟随按钮文字），内联雪碧图，不依赖外部资源：

| 文件 | 作用 |
| --- | --- |
| `icons.js` | 定义 46 个图标符号（`symbol#i-*`）并注入文档；对外暴露 `spineIcon(name)` |
| `icons-preview.html` | 图标一览页（含多尺寸缩放效果），改图标时先在这看 |

新增图标：在 `icons.js` 的 `ICONS` 里加一条（`viewBox="0 0 16 16"`，只写内部路径），
然后在 `index.html` 里用 `<svg class="ic"><use href="#i-名字"></use></svg>`，或直接调 `spineIcon("名字")`。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `index.html` | 语义 DOM（工具条 / 画布 / 右栏 / 帮助浮层）；script 顺序 `icons.js → spine-core.js → fixtures/cases.js → app.js` |
| `ui.css` | 全部样式与设计令牌（颜色 / 间距 / 字号 / 圆角 / 焦点环） |
| `app.js` | 应用层：载入、画布、状态、交互、撤销、导出（渲染只调 core 的数学） |
| `spine-core.js` | 纯数学与解析（atlas / model / 采样 / 矩阵 / IK / 蒙皮 / 命中 / 几何），无 DOM 依赖 |
| `fixtures/cases.js` | 内置样张与期望值（界面用 `example: true` 的部分，其余在 selftest 里跑断言） |
| `selftest.html` / `selftest.js` | 断言页 |
| `serve.py` / `start.sh` / `start.bat` | 本地静态服务与启动脚本 |

## 为什么不用官方 Spine 编辑器

官方编辑器能做网格、权重、物理、缓动曲线，是精修的正路；但它需要付费授权。
这个工具解决的是「只想把部件摆正、把层级调对、顺手看一眼网格和权重」的高频小事，零依赖、开箱即用。
