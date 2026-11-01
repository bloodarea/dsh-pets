# 贡献指南 · 文件卫生规则

> 本仓是 DeepSeek Harness 的跨平台桌面宠物插件（Spine 角色 + 会话切换 + 任务完成提醒）。
> 文件卫生的目标只有一句话：**仓库只装"重建它所需的最小集合"——源码、声明、必要资源；其余一切留在本机。**
> 规则由 `.gitignore` 宣布、由 `scripts/verify-hygiene.sh` 强制执行（pre-commit 钩子调用），两者必须同步修改。

## 1. 目录约定

| 路径 | 入库 | 说明 |
| --- | :---: | --- |
| `src/` `client.js` `server.js` 等源码 | ✅ | 插件实现本体 |
| `package.json` `pnpm-lock.yaml` `.gitignore` 等声明 | ✅ | 锁定依赖与工具链 |
| `README.md` `README_zh.md` `CONTRIBUTING.md` `AGENTS.md` | ✅ | 对外文档与协作约定 |
| `scripts/` | ✅ | 构建 / 校验 / 发布脚本 |
| `THIRD-PARTY-NOTICES.md` | ✅ | 第三方代码与资源出处、许可证 |
| `LICENSE` | ✅ | 分离授权总述：代码 MIT / 角色资产 CC BY-NC-SA 4.0 |
| `assets/characters/deepseek/**` | ✅ | **默认角色包**（Spine 模型、语音、preview），随程序打包 |
| `assets/characters/index.json` | ✅ | 可下载角色索引（版本 / sha256 / 下载地址） |
| `assets/characters/<其他 id>/**` | ❌ | 其他角色按需下载，运行时落 `~/.dsh/pets/characters/` |
| **`docs/**`（文档、设计稿、调研笔记、PDF/Office 文件）** | ❌ | 内部文档只在本地保存 |
| **`docs/assets/*.png` 等图片** | ✅ | README 需要引用的图片与截图（**唯一例外**） |
| **`references/`** | ❌ | 参考项目源码、技术实验、验证脚本、抓包与实验数据 |
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

## 4. `references/`：参考项目与技术实验的隔离区

用于存放：clone 下来的同类/上游项目、技术验证 demo、Spine 渲染与窗口层/Electron 能力的实验代码、性能测试与抓包数据。**整目录不入库**，理由：

1. 体积与历史污染：第三方仓库动辄数十 MB，一旦入库会永久留在 git 历史里；
2. 许可证风险：参考项目的 LICENSE 与本仓未必兼容，拷贝进来等于事实上的再分发；
3 可复现性：实验结论应沉淀为 `docs/`（本地）或最终代码，而不是把实验现场提交上去。

确需引用第三方代码时的做法：**要么重写，要么只取最小片段 + 在 `THIRD-PARTY-NOTICES.md` 记录出处、许可证与改动**；第三方依赖一律走 `package.json`，不要 vendored 拷贝。

## 5. 提交前自检

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

## 6. 修改规则的流程

1. 同时改 `.gitignore` 与 `scripts/verify-hygiene.sh`（二者是同一规则的两份表述：前者防误加，后者防强推）；
2. 在本文件补齐说明与理由；
3. 用 `scripts/verify-hygiene.sh --all` 验证存量文件仍然合规；
4. 在提交说明里写清规则变更与影响面。
