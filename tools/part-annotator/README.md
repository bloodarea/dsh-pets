# 立绘语义标注器（零依赖，本地用）

把一张**原立绘**按部件切开、给每件定义语义（名称 / z 序 / 可见区 / 被遮挡补全），
并能**载入本仓库已有的拆分件**作为候选掩码，在它的基础上改错、挪像素、合并、拆分。
产出是给拆件流水线消费的 `annotations.json + masks/*.png + cuts/*.png`，不是运行时资源。

与 [`tools/character-editor`](../character-editor/) 同一套零依赖架构与设计语言：
Python 标准库起静态服务 + 单页 Canvas，不装 npm / pip 依赖。两者是独立工具：
character-editor 调 **rig 摆位/动画预览**，本工具定 **源画的语义分层**。

## 启动

三平台一条命令（只需 Python 3）：

| 平台 | 命令 |
| --- | --- |
| Windows | 双击 `tools\part-annotator\start.bat`，或命令行 `start.bat` |
| Linux / macOS | `./tools/part-annotator/start.sh` |

脚本会自动选空闲端口（默认 8123，占用往后找）→ 在**仓库根目录**起静态服务 → 打开浏览器。
`--port 9000` 指定端口，`--no-browser` 只起服务。等价手工方式：

```bash
cd <仓库根目录>                       # 必须是 dsh-pets 仓库根
python3 tools/part-annotator/serve.py --port 8123 --no-browser
# 浏览器打开 http://127.0.0.1:8123/tools/part-annotator/
```

> 必须起服务：编辑器要 `fetch` 仓库里的 `assets/source/...` 原图与 `workspace/...` 拆分件，
> 浏览器对 `file://` 的 fetch 一律拒绝。

Windows 排错：若双击 `start.bat` 闪退或提示找不到命令，先在仓库根开一个命令行执行

```bat
python tools\part-annotator\serve.py --no-browser
```

错误会直接打印在窗口里（常见原因：PATH 里没有 Python 3）。`start.bat` 已按 cmd 要求写成
**CRLF + ASCII**，依次尝试 `DSH_PETS_PYTHON` 环境变量 → `py -3` → `python`，避免中文编码把批处理解析坏；
Python 不在 PATH 时先 `set DSH_PETS_PYTHON=C:\path\to\python.exe` 再双击即可。

## 工作流

1. **载入原立绘**：文件 → 载入原立绘…（列出 `assets/source/<角色>/three-view/*.png`），
   或直接把 PNG 拖进画布。画布尺寸 = 原图像素尺寸，不缩放。
2. **载入现有拆分件（可选）**：文件 → 载入现有拆分件…，从
   `workspace/characters/<角色>/output/parts/*/manifest.json` 选一个。工具按 manifest 的
   `composition.backToFront` 从后到前把每件的 alpha（>10）填成候选掩码——这就是「编辑现有拆分语义」的起点。
3. **建部件 / 框选**：
   - 右侧「新建」建一个部件（自动配色 + z 序），在检查器里改名 / 备注。
   - **矩形（R）**：拖一个框；**多边形（P）**：单击加顶点、双击 / Enter 闭合、Backspace 去点、Esc 取消。
   - 默认「选区自动赋值」开：松手即写入当前部件；关掉后可先留选区，再用画布底部的
     **赋给当前件 / 从当前件减去 / 新建部件** 三个按钮决定去向。
   - **画笔（B）/ 橡皮（E）** 修发丝和边缘；**魔法棒（W）** 按容差选同色区域（专治 navy 胸甲/围裙/领结这类同色相邻）。
4. **改语义**：在部件列表里选中某件，再框选原属别件的区域赋给当前件，就完成了「挪像素」；
   「合并」把另一件并进当前件，「删除」把该件像素归零，行内 `▲▼` 调 z 序，眼睛只影响显示、不影响导出。
5. **可见区 / 被遮挡补全**：检查器里的「通道」切换。`可见区` = 原图真正露出的像素；
   `被遮挡补全` = 原图看不见、但部件本身应有的延伸（可选，不画则导出为 hidden-only）。
6. **保存 / 导出（标准拆件包）**：
   - **Ctrl+S = 写回当前包**：打开 `.../parts-bundles/<包名>/index.json` 后，改动直接写回**同一个文件夹**
     （`index.json`/`parts.json`/`masks/`/`cuts/`/`composite.png`/`preview.png` 重写；`layers/`、`report.md`
     原样保留）。没打开包时先提示包名，等于新建。
   - **Ctrl+Shift+S = 另存拆件包**：改名 → 写 `workspace/characters/<角色>/parts-bundles/<新名>/`，原包不动。
   - 文件 → **按路径打开拆件包…**：仓库任意相对路径的 `index.json`（不限于 `parts-bundles/`）。
   - 文件 → 导出拆件包 ZIP：纯前端打包，**`index.json` 在 ZIP 根目录**，只读服务也可用。
   - 「载入现有拆分件 → 保存」会保留原 `layers/`，并补出 `masks/`、`cuts/`、`composite.png`、`preview.png`。

## 拆件包（parts-bundle v1）

一个文件夹 = 一个工程，与**人物包**同构：`index.json` 是唯一入口，所有引用都是包内相对路径，
整包可以移动、拷进 ZIP、解包后再打开，不依赖仓库其它目录。完整 schema 与校验规则见
**[BUNDLE.md](BUNDLE.md)**。最小结构：

```text
<拆件包>/
├── index.json           # 入口：character/view/canvas/base/partsFile/files
├── parts.json           # 部件清单：id/name/z/files + backToFront
├── base.png             # 原立绘（尺寸 = canvas）
├── layers/<id>.png      # 成品 RGBA 全画布层（可选；含被遮挡补全）
├── masks/<id>.png       # 可见区二值掩码（可选；可见区真值）
├── cuts/<id>.png        # 按可见区从 base 切出的 RGBA（可选）
├── hidden/ cuts-hidden/ # 被遮挡补全（可选）
└── composite.png preview.png report.md   # 可选
```

约定摘录：

- 画布永远等于原图像素尺寸（1091×1442 之类），不重采样；`alphaMode = straight`。
- `-l` = 角色自身左 = 画面右；`z` 大 = 更靠前；`parts.json.backToFront` 恰好列出每件一次（后 → 前）。
- `masks/` 是可见区真值；`layers/` 含被遮挡补全；`hidden/` 只是补全范围声明（推测），不是原图观测。
- 最多 251 件；`annotations.json` 是旧标注兼容文件（工具保存时附带），**不是**拆件包权威。

## 问题标注（issues）

这个工具的主要用途是**标注与反馈**，不替用户执行拆分。除了「部件」页定义语义，
「问题」页记录“哪里不对、应该改成什么样”，供返修使用：

- 顶部切 **部件 / 问题** 模式；「问题」页新建问题，选择
  **类型**（边缘缺失 / 毛边锯齿 / 拆少了 / 拆多了 / 归属错误 / 补全质量 / 其他）、
  **严重度**（低/中/高）、**关联件**、备注。
- 三类目标各存一张**同画布二值掩码**（互不覆盖、可撤销），语义按“谁定义”区分：
  - **问题位置**（必填）：问题发生在哪一块像素。**矩形 / 多边形 / 魔法棒**都能用，
    每画一次就**累加**一块——互不相邻的选区会保留成多块（面板 `位置 px` 后面直接显示“· N 块”），
    方便把每块问题区域单独裁出来看；
  - **改动前**（可选）：**不画选区**。直接点画布上的某个拆分部件（或在「改动前件」下拉里选），
    表示“这个问题发生在哪一件”，`before` 掩码取该件的**可见区像素**；所以先得有拆分件
    （没载入拆分件时该目标会被拒绝、下拉置灰）；
  - **改动后**（可选）：期望的区域（该归哪件、该补到哪里）。同样接受矩形 / 多边形 / 魔法棒，
    一样可累加多块；不要求选区完整——返修时按它向外扩散即可。
- **什么时候会写进问题掩码**：只有在「问题」模式下、且目标选在**问题位置 / 改动后**时，
  画布上的选区才会累加进去。切到「部件」模式、或把目标切走，就不再往这三类里加东西；
  在「改动前」目标下拿起绘制工具会自动切回「问题位置」（避免把选区写进 before）。
- 右键画布有上下文菜单：取消选区、取消选中（部件 / 问题）、写入 / 擦除、撤销 / 重做、
  问题层显隐、适配、保存。魔法棒点在**画布外或透明处**会取消当前选区。
- 部件列表的**眼睛**只影响显示：隐藏的件会从底图里被抠掉（底图 + 掩码叠加一起生效），不影响导出。
- 保存时写 `issues.json` + `issues/<id>.png`（+ `-before` / `-after`），
  `index.json` 增加 `issuesFile` / `issues` / `files.issues`。
  schema 与语义见 **[BUNDLE.md](BUNDLE.md)** §3.5。

下游（人或 AI）可直接按 `issues.json` 的 `type + files.region + before/after`
定位问题并返修，不需要再从自然语言里猜。问题标注是**审查记录**，不覆盖 `masks/` 的权威性。

## 快捷键

| 键 | 作用 |
| --- | --- |
| V / R / P / B / E / W | 选择 / 矩形 / 多边形 / 画笔 / 橡皮 / 魔法棒 |
| 空格（按住）/ 中键拖动 | 平移画布（选择工具左键也可拖） |
| 滚轮 / `+` `-` / F | 缩放 / 适配 |
| Enter | 闭合多边形或把选区赋给当前件 |
| Del | 从当前件减去选区（多边形未闭合时删最后一个点） |
| Esc | 取消选区 / 关对话框 |
| Ctrl/⌘+Z / Ctrl/⌘+Shift+Z | 撤销 / 重做（画笔整笔一条、最多 40 步） |
| Ctrl/⌘+S | 写回当前拆件包（未打开包时先要名字） |
| Ctrl/⌘+Shift+S | 另存拆件包 |
| Ctrl/⌘+O | 载入原立绘 |
| Ctrl/⌘+Shift+N | 用选区新建部件 |
| M / F / `[` `]` | 掩码开关 / 适配 / 选中件下移、上移一层 |
| ? | 打开右侧「说明」 |

## 服务接口（`serve.py`，仅回环可写）

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/capabilities` | `{apiVersion, saveProject, root}` |
| GET | `/api/sources` | 列出 `assets/source/*/three-view/*` 图片 |
| GET | `/api/splits?character=` | 列出 `workspace/characters/<c>/output/parts/*/manifest.json` |
| GET | `/api/projects?character=` | 列出旧标注工程（`annotation/*/annotations.json`） |
| GET | `/api/project?path=` | 读取 `annotations.json`（限 `workspace/characters` 下） |
| GET | `/api/bundles?character=` | 列出拆件包（`parts-bundles/*/index.json`） |
| GET | `/api/bundle?path=` | 读取拆件包 `index.json` + `parts.json`（限 `workspace/characters` 下） |
| POST | `/api/save-bundle` | 写拆件包：`index.json / parts.json / base*.png / composite/preview / layers|masks|cuts|hidden|cuts-hidden/<id>.png` |
| POST | `/api/save-project` | 旧标注工程（兼容保留） |

安全边界：写接口只在 `127.0.0.1` / `localhost` 监听时启用；路径段白名单、PNG 签名校验、
体积上限、临时文件 + `os.replace` 原子写。非回环启动一律只读。

## 自测

```bash
# 浏览器
http://127.0.0.1:8123/tools/part-annotator/selftest.html     # 33 / 33 passed
# 命令行（同一套断言）
node tools/part-annotator/selftest-node.mjs
```

覆盖：标签图、矩形（含反向角/越界）、多边形扫描填充、画笔/笔迹、颜色洪水填充、
连通域块数（多选区口径）、撤销 diff、工程 schema、导出命名、CRC32、ZIP（store）结构、data URL 解析，
以及拆件包 v1 的 index/parts 校验、fromAnnotation 映射、ZIP 根目录入口、路径逃逸拒绝。

## 端到端验证记录（2026-11-03）

- 载入 `workspace/characters/deepseek/output/parts/manifest.json` 的 24 件候选掩码 → 画布 1091×1442；
- 新建部件 + 矩形 `(300,300)-(520,560)` 赋值 = **57,200 px**；撤销后回到 0；
- **保存为拆件包**：`workspace/characters/deepseek/parts-bundles/deepseek-front-v1/`，
  **79 个文件**（24 `layers/` + 24 `masks/` + 24 `cuts/` + `base/composite/preview/report/annotations` + `index/parts`），约 **11.1 MB**；
  `bundle.js` 校验 `ok`，`?bundle=` 重新打开后 24 件、画布 1091×1442；
- **写回同一包**：把该包复制为 `overwrite-test` → 打开 → 新建 `leg-l-demo`（13,500 px）→ Ctrl+S 写回原目录
  （status 显示“写回 overwrite-test”，25 件），`layers/`、`report.md` 仍在（HEAD 200）、
  `masks/leg-l-demo.png` 新增，`index.parts=25`；
- **问题标注（2026-11-03 二次验证，CDP 驱动真实页面 + 复制包落盘）**：打开 24 件包 →
  新建 `edge-missing`（关联 `hair-front`）→ **改动前自动 = `hair-front` 可见区 325,218 px**（不用画）→
  **问题位置**：两次矩形 10,100 + 10,000 px 累加成 **20,100 px / 2 块**，再用魔法棒累加到 587,805 px →
  **改动后**：多边形 3,240 px + 矩形再 +6,480 px = 9,720 px / **2 块** →
  **改动前**改为点画布点选 `hair-back`（213,065 px = 该件可见区），再拿起矩形工具会自动切回「问题位置」且 before 不变 →
  切回「部件」模式后再画，问题掩码不再变化 → 撤销只回退最后一块（9,720 → 10,000 前的值）→ Ctrl+S 写出
  `issues.json`（含 `beforePartId`、`pixels.blocks`）+ `issues/issue-1[-before|-after].png`；
  `?bundle=` 重开该包：24 件 / 1 条问题，`位置 587,805 / 改动前 213,065 / 改动后 9,720` 与 before 下拉全部还原；
- **另存不丢 layers**：另存副本后 `layers/` 仍在（HEAD 200），ZIP 导出 78 条且 `index.json` 唯一；
- 截图与复跑脚本在 `workspace/characters/deepseek/annotation-shots/` 与 `workspace/tmp/`（本地，不入库）。

## 已知限制

- 不做图像生成/补全：本工具只定义语义与掩码；被遮挡区的内容仍由 See-through / 图生图路线补。
- 「新建部件」这一步不进入撤销栈（撤销只覆盖像素改动）；删除/合并会整体快照。
- 没有图层锁定、变换、羽化、选区加减模式：问题位置 / 改动后的选区永远是**累加**（多块保留），
  要去掉某块用 Del / 右键「从当前目标擦除」；「改动前」由选中的部件决定，不接受手画。
- 一次只编辑一个通道（visible / hidden）；两个通道共用同一份部件表。
- 最多 251 件；旧标注工程的 `label.png` 用 R 通道存索引，不适合直接当预览图（用 `preview.png`）。
- **写回不删除旧文件**：删掉的部件会留下旧的 `layers|masks|cuts/<id>.png`（孤儿文件）；要干净用「另存新包」。
- 打开包 = 读取一个**文件夹**：浏览器不能凭本地文件路径读同目录兄弟文件，所以必须经工具服务
  （列表 / 按路径 / `?bundle=`）；**直接双击 `index.json` 不会打开工程**，这一点和 PSD 单文件不同。
- 拆件包校验当前不拒绝未知字段（方便先扩 schema 再收紧）；`annotations.json` 只是兼容文件。
- 浏览器 Canvas2D 渲染；半透明贴图的叠加与 GPU 运行时可能有 ≤1px 抗锯齿差异。