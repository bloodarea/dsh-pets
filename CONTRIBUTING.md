# 贡献指南 · 文件卫生规则

> 本仓是 DeepSeek Harness 的跨平台桌面宠物插件（Spine 角色 + 会话切换 + 任务完成提醒）。
> 文件卫生的目标只有一句话：**仓库只装"重建它所需的最小集合"——源码、声明、必要资源；其余一切留在本机。**
> 规则由 `.gitignore` 宣布、由 `scripts/verify-hygiene.sh` 强制执行（pre-commit 钩子调用），两者必须同步修改。

## 1. 目录约定

| 路径 | 入库 | 说明 |
| --- | :---: | --- |
| `index.js` `src/` `client.js` `server.js` 等源码 | ✅ | 插件实现本体（Host 入口 / 前端半） |
| `cordis.patch.yml` `locale/` `icon.svg` | ✅ | 激活补丁与插件显示元数据（标题 / 描述 / 图标） |
| `package.json` `pnpm-lock.yaml` `.gitignore` 等声明 | ✅ | 锁定依赖与工具链 |
| `README.md` `README_zh.md` `CONTRIBUTING.md` `AGENTS.md` | ✅ | 对外文档与协作约定 |
| `scripts/` | ✅ | 构建 / 校验 / 发布脚本 |
| `THIRD-PARTY-NOTICES.md` | ✅ | 第三方代码与资源出处、许可证 |
| `LICENSE` | ✅ | 分离授权总述：代码 MIT / 角色资产 CC BY-NC-SA 4.0 |
| `assets/characters/deepseek/**` | ✅ | **默认角色包**（Spine 模型、语音、preview），随程序打包 |
| `assets/characters/index.json` | ✅ | 可下载角色索引（版本 / sha256 / 下载地址） |
| `assets/source/**` | ✅ | **拆件精修工作区**：三视图源、拆分部件、表情差分与 manifest（构建输入，不参与运行时加载） |
| `skills/**` | ✅ | **插件内置技能**：随包分发的 `skills/<name>/SKILL.md`，由插件入口注册；与仅本地的 `.agents/skills/` 严格区分（见 §5b） |
| `assets/characters/<其他 id>/**` | ❌ | 其他角色按需下载，运行时落 `~/.dsh/pets/characters/` |
| **`docs/**`（文档、设计稿、调研笔记、PDF/Office 文件）** | ❌ | 内部文档只在本地保存 |
| **`docs/assets/*.png` 等图片** | ✅ | README 需要引用的图片与截图（**唯一例外**） |
| **`references/`**（仓库根） | ❌ | 参考项目源码、技术实验、验证脚本、抓包与实验数据 |
| **`workspace/`**（仓库根） | ❌ | 部件拆分工作现场与运行环境（模型权重、拆件中间产物） |
| **`.agents/`**（项目技能） | ❌ | 仅本地：DSH 从 `.agents/skills/<name>/SKILL.md` 发现技能 |
| `experiments/` `playground/` `sandbox/` | ❌ | 一次性技术验证，同上 |
| `node_modules/` `dist/` `build/` `out/` `coverage/` | ❌ | 依赖与构建产物，可由安装/构建重建 |
| `.env*` `*.pem` `*.key` `secrets.json` | ❌ | 凭据与本地配置，一经泄露不可回滚 |
| `*.log` `tmp/` `*.bak` `.DS_Store` `.idea/` `.vscode/` | ❌ | 日志、临时文件、编辑器与系统垃圾 |

## 2. `docs/`：只让 README 需要的图片通过

`docs/` 整体被忽略，白名单**只有** `docs/assets/` 下的扁平图片文件：

- 允许扩展名：`.png` `.jpg` `.jpeg` `.gif` `.webp` `.svg` `.avif`
- **必须扁平**：`docs/assets/` 下不建子目录（`.gitignore` 的否定规则无法穿透被排除的父目录）
- README 中引用写相对路径：`![宠物面板](docs/assets/pet-panel.png)`
- 命名用 kebab-case 并体现内容：`pet-panel.png`、`settings-spine.png`、`session-switch.gif`

图片体积门禁（`scripts/verify-hygiene.sh` 硬校验）：

| 项 | 阈值 | 说明 |
| --- | --- | --- |
| 建议值 | ≤ 1 MiB | 超过只告警 |
| 硬上限 | 3 MiB | 超限阻止提交，需压缩或降分辨率 |
| 通用单文件 | 5 MiB | 任何非图片文件超限即阻止 |
| 角色资源单文件 | 8 MiB | Spine 贴图 / 语音上限，超限要求压缩 |

不收的媒体：录屏 `mp4`、带声音的演示、`pdf/docx/pptx`、原始设计稿（Figma/AI/PSD）。需要动图就转 `webp` 或 `gif` 再压。

## 3. `assets/characters/`：只放默认角色包

角色资源分两类存放，仓库里只保留第一类：

| 类别 | 位置 | 谁写 | 是否入库 |
| --- | --- | --- | --- |
| 默认角色（随程序打包） | `assets/characters/deepseek/**` | 版本发布时确定 | ✅ 入库 |
| 其他角色（按需下载） | `~/.dsh/pets/characters/<id>/**` | 运行时下载 | ❌ 永不入库 |

- 白名单只有两项：`assets/characters/deepseek/**` 与 `assets/characters/index.json`；
  其他 `assets/characters/<id>/` 一律忽略，且 `verify-hygiene.sh` 会拦住 `git add -f`。
- **不要把下载包写进 `assets/`**：安装目录在打包后只读（macOS 在 `.app` 内）、全局安装的
  `node_modules` 会被更新整目录替换，用户下载的角色会丢。
- 运行时解析顺序：用户目录 > 内置目录（同名时用户覆盖内置），并提供"重置为内置"。
- 每个角色包必须有 `manifest.json`（`schemaVersion` / `id` / `version` / `render` / `states` /
  `fallback` / `voice` / `license` / `licenseUrl` / `credits`）、`LICENSE` 与 `ATTRIBUTION.md`
  （来源链 + 未采用内容 + 修改说明）；格式细节见本地文档
  `docs/architecture/character-pack-format.md`（`docs/` 不入库）。
- **许可**：默认包素材采用 **CC BY-NC-SA 4.0**——必须署名 上善无形/上善 与 ZipZipPipe，
  **禁止任何商业用途**，演绎须同许可并注明修改。CC 许可不得附加额外限制，"仅供学习参考"
  只能作为项目立场表述。依据：<https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans>、
  作者声明 <https://www.bilibili.com/opus/1247156596114456581>。
- **不收录**厂商官方素材（头像、Logo、官方插画）与未获授权的配音；权利人异议按上述同款
  Issue 流程核实后移除（CC 不可撤销，承诺为"停止分发"）。
- **授权前置**：Spine 运行时与导出动画数据受 Esoteric Software 的商业许可约束，新增角色包前
  先确认许可与素材来源；品牌主题（DeepSeek / Claude / GPT / Kimi / Qwen）需标注"非官方"。

## 3b. `assets/source/`：拆件精修工作区（构建输入）

「三视图 → 拆分部件 / 表情差分」的精修工作区：存源素材（三视图）、切件产出（1× / 图集尺度）、
表情差分与每批素材的 `manifest.json`。**不参与运行时加载，也不进角色 ZIP 包**。

- 只放图片与 JSON 清单；生产脚本留在本机 `output/work/`（不入库），目录语义与复现命令写在
  `assets/source/README.md`；
- 新增 / 替换图片必须同步更新对应 `manifest.json` 的 `size` / `bbox` / `sha256` 与度量字段；
- 体积按通用门禁（单文件 ≤ 5 MiB），当前最大文件 < 1 MiB；
- 许可仍按角色素材处理（CC BY-NC-SA 4.0，署名见 `assets/characters/deepseek/ATTRIBUTION.md`）。

## 4. `references/`：参考项目与技术实验的隔离区

用于存放：clone 下来的同类/上游项目、技术验证 demo、Spine 渲染与窗口层/Electron 能力的实验代码、性能测试与抓包数据。**整目录不入库**，理由：

1. 体积与历史污染：第三方仓库动辄数十 MB，一旦入库会永久留在 git 历史里；
2. 许可证风险：参考项目的 LICENSE 与本仓未必兼容，拷贝进来等于事实上的再分发；
3 可复现性：实验结论应沉淀为 `docs/`（本地）或最终代码，而不是把实验现场提交上去。

确需引用第三方代码时的做法：**要么重写，要么只取最小片段 + 在 `THIRD-PARTY-NOTICES.md` 记录出处、许可证与改动**；第三方依赖一律走 `package.json`，不要 vendored 拷贝。

规则只作用于**仓库根**（`.gitignore` 里的前导 `/`）：`skills/<name>/references/` 是技能随包资源，会正常入库（见 §5b）。

## 4b. `workspace/`：部件拆分与运行环境（仅本地）

用于「三视图 → 部件拆分」的实际工作现场，以及本机运行环境（模型权重、推理依赖等）。**整目录不入库**：

1. 拆件中间产物（切片、蒙版、实验性图集）与模型文件体积大，且可由源素材与工具链重建；
2. 模型与工具通常带独立许可证，未核实来源就入库等于再分发；
3. 工作现场含调试痕迹与本机路径，不适合作为团队共享产物。

需要长期保留的产出放 `assets/source/`（图片 + `manifest.json`，见 §3b），结论与复现步骤放 `docs/`（本地）。
与 `references/` 一样，`scripts/verify-hygiene.sh` 也会拦住 `git add -f`。

## 5. `.agents/`：项目技能（仅本地）

`<projectRoot>/.agents/skills` 是 DSH 的项目级技能发现路径（来源 `project-agents`，rank 200）：
每个技能一个目录，内含 `SKILL.md`（或以 `<name>.md` 扁平文件形式），只扫描直接子项，
不支持嵌套 `**/SKILL.md`；frontmatter 必填 `name` 与 `description`。

```text
.agents/
├── README.md            # 约定说明（本地）
└── skills/
    └── <skill-name>/
        └── SKILL.md
```

- **整个 `.agents/` 不入库**：技能常含本机路径、内部约定与未公开做法，属于工作资产；
- 需要对外分享的技能，另写脱敏版放进 `docs/`（本地）或直接写进 `README.md`；
- 不要在 `.agents/skills/` 下放 `README.md`——它会被当成扁平 skill 扫描，缺 frontmatter 会告警；
- 更高优先级的 `<projectRoot>/.dsh/skills`（rank 100）已被 `.dsh/` 规则覆盖，同样只在本机。

## 5b. `skills/`：插件内置技能（随包分发）

与 `.agents/` 相对：**属于产品、要随包分发的技能放 `skills/` 并入库**；只对本机有效的操作习惯放
`.agents/skills/`。DSH 不会自动把插件包里的目录当成技能根——必须由插件入口注册：

- 形态一（自带 provider）：插件激活时用 `@deepseek-ai/dsh-skill-filesystem` 的
  `FileSystemSkillProvider`，只扫本包 `skills/`（`includeDefaultRoots: false` +
  `customSkillDirs: [<pkg>/skills]`），经 `ctx.skills.registerProvider()` 挂上；
  参考 `dsh-brooks-lint-dsh`。
- 形态二（内嵌注册）：激活时读 `skills/<name>/SKILL.md` 文本，`ctx.skills.register(skill)`
  注册成进程内 `runtime` provider，不落扫描根；参考 `dsh-agent-team-ui-testing`。

**本仓当前实现**：采用形态二，入口在 `index.js`。激活时扫描 `skills/` 的直接子项（目录
bundle 或扁平 `.md`），解析 frontmatter 后逐个 `ctx.skills.register()`；单条技能解析失败
只告警并跳过。这样插件不依赖 `@deepseek-ai/dsh-skill-filesystem`——本仓以 `link:` 方式装进
profile，链接目录没有自己的 `node_modules`，零安装即可激活。取舍：SKILL.md 只在激活时读取，
改完需重载插件行或重启 Harness；frontmatter 只支持平铺的 `key: value` 单行标量。技能数量
增多、需要热更新时，再按形态一换成 `FileSystemSkillProvider` 并补依赖。

```text
skills/
└── <skill-name>/
    ├── SKILL.md          # YAML frontmatter 必填 name（kebab-case）与 description
    └── references/       # 可选：prompt 模板、清单等 bundle 资源
```

- 目录只扫直接子项：`skills/<name>/SKILL.md`；**不要在 `skills/` 根放 `README.md`**（会被当扁平 skill 扫描）。
- 打包：package.json 的 `files` 必须包含 `skills`（或 `skills/**`），否则 npm 包不携带。
- 当前内置技能：`three-view-parts`（三视图 → 部件贴图）。
- **公开技能必须环境无关**：不写本机网关地址、模型 id、本机路径、个人脚本；这些差异放
  `.agents/skills/` 的指针技能，由它指向公开技能（例：`three-view-parts` ↔
  `three-view-parts-local`）。公开发布的内容要让陌生人只凭技能正文就能执行。

## 6. 提交前自检

```bash
# 每个克隆执行一次，装 pre-commit 钩子
scripts/install-hooks.sh

# 钩子会自动跑；也可手动检查
scripts/verify-hygiene.sh          # 暂存区
scripts/verify-hygiene.sh --all    # 全部已跟踪文件（CI / 发布前）
scripts/verify-hygiene.sh --files docs/a.md references/x.js   # 排查指定路径
```

违规时的补救（保留本地文件，只从索引移除）：

```bash
git rm --cached -r references/      # 若已进入暂存区
git rm --cached docs/spec.md
git commit --amend --no-edit        # 若已提交但未推送
```

若错误文件已被推送：优先 `git revert` 或重写历史后强推并通知协作者；涉及凭据时必须**先吊销密钥**，再清历史。

`--no-verify` 只允许在确认误判时使用，且必须在 PR / 提交说明里写明原因，否则视为违规。

## 7. 修改规则的流程

1. 同时改 `.gitignore` 与 `scripts/verify-hygiene.sh`（二者是同一规则的两份表述：前者防误加，后者防强推）；
2. 在本文件补齐说明与理由；
3. 用 `scripts/verify-hygiene.sh --all` 验证存量文件仍然合规；
4. 在提交说明里写清规则变更与影响面。
