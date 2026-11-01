# 素材来源与出处核查 · deepseek 角色包

本文件记录素材的完整创作链、可核实来源与**未采用**的内容，便于权利人核查与后续维护。
法律条款见同目录 [LICENSE](LICENSE)。

## 1. 创作链

```
上善无形 / 上善（原始鲸鱼娘形象）
   └─ ZipZipPipe（加入 DeepSeek 元素与女仆装，明确声明 CC BY-NC-SA 4.0）
        ├─ lmy414/ai-chan-sheets    设定图补全、三视图整理
        └─ Photonico/AI_characters  Q 版、视图、提示词记录
```

ZipZipPipe 在《大AI和小AI们》简介与 2026-09-12 动态中明确：DeepSeek 二次设计采用
**CC BY-NC-SA 4.0**，形象不可商业化。

- 作者版权声明（2026-09-12 动态）：https://www.bilibili.com/opus/1247156596114456581
- 作品简介：https://www.bilibili.com/video/BV1tE9XBbErS/
- CC BY-NC-SA 4.0 中文说明：https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans

## 2. 上游仓库与许可状态

| 仓库 | 角色 | 许可声明 | 核验备注 |
| --- | --- | --- | --- |
| https://github.com/lmy414/ai-chan-sheets | 设定图 / 三视图 / 脚本 | 自有部分 CC BY-NC-SA 4.0；原形象版权归 ZipZipPipe | 第 12、13、14 条来源作者「未标注 / unknown」，本包**未采用**这几条 |
| https://github.com/Photonico/AI_characters | Q 版、视图、prompt 记录 | README 写「originally licensed under CC BY 4.0, modifications by Photonico」 | 该仓库无 LICENSE 文件；其 BY 4.0 声明与上游 NC-SA 4.0 不兼容，**本包按更严格的 NC-SA 4.0 处理** |
| https://github.com/shuaizenge/ai-girls | 素材整理与逐项出处（`catalog.json`） | 不授予新许可，仅记录来源 | 用作出处核查依据，不直接取用文件 |

## 3. 未采用的内容（重要）

| 内容 | 原因 |
| --- | --- |
| `ai-chan-sheets` 第 12/13/14 条（冬装小肥鱼、白紫龙娘小 GPT、Claude 工牌工作服） | 来源作者与授权均为 unknown，无法确认权利状态 |
| `ai-girls` 中的 `DeepSeek娘_人声.mp3` | 该页明确「未经作者授权禁止转载」，且含 AI 生成语音，不可再分发 |
| 任何厂商官方素材（头像、Logo、官方插画） | 品牌与商标权利，非社区同人素材 |
| 第三方配音 | 需独立授权；本包 `voice/` 暂为空，不做内置语音 |

## 4. 本包的改动

裁切、缩放、透明背景处理、Spine 图集与骨骼重组、目录结构化。**未改**角色设定与配色。

具体处理链（`spine/` 由三视图立绘程序化生成）：

1. 近白背景泛洪去除（保留围裙、蕾丝等角色内部白色）；
2. 按列主体计数切出正/侧/背三栏；
3. 各栏裁边、等比缩放到 720px 高、脚底对齐；
4. 打包为单页图集（`model.png` + `model.atlas`，2048² 货架式装箱，含 3px bleed）；
5. 装配 Spine 4.2 骨架：`root → body → head` 三骨，三个视图作为同一槽位的可切换附件；
   动画 `idle / working / attention / done / failed / turn`（整身变换 + 视图切换）。

## 5. 当前资产状态与限制

| 项 | 状态 |
| --- | --- |
| `spine/model.json` / `model.atlas` / `model.png` | ✅ 已生成，官方 spine-core 4.2 无头校验通过（3 骨 / 1 槽 / 3 区域 / 6 动画） |
| `preview.webp` | ✅ 已生成（512px 高） |
| 语音 `voice/` | ⏳ 待补，须自行录制或已获授权 |
| 拆件（头/身/四肢/头发独立摆动） | ❌ 未做。三视图是三个整身姿态，**不是分层素材**，无法据此拆骨 |
| 网格形变 / 权重 / 眨眼嘴型 | ❌ 未做，需分层源图或 GPU 语义拆层（ComfyUI + See-through） |

也就是说：当前动效是「整身变换 + 三视图切换」，能跑、能看、可被运行时加载，
但没有肢体独立动作。要升级为真正的拆件骨骼，需要分层素材（见下）。

需要的素材规格（分层源）：

- 同一画布的透明 PNG 分层（或 PSD），层序：后发 / 身体+裙 / 腿×2 / 手臂×2 / 头 / 前发 /
  眼白 / 瞳孔 / 上眼睑 / 嘴 / 头饰 / 尾巴；
- 被遮挡区域必须补全（inpaint），否则转动时露出空洞；
- 源分辨率约为显示高度的 2–3 倍（桌宠显示 480px → 源图 1200–1440px 高）；
- 表情差分同画布：happy / sad / surprised / focus。

## 6. 更正与下架

发现署名错误、来源缺失或权利争议，请在
https://github.com/bloodarea/dsh-pets/issues 提交，注明文件路径与可核实的作品出处。
