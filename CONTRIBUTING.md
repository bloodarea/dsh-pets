# 贡献指南 · 文件卫生规则

> 本仓是 DeepSeek Harness 的跨平台桌宠运行项目，计划消费完整人物包并提供动画、预录制语音、会话切换与任务提醒。当前 Host 入口仅为占位，运行功能尚未实现。
> 人物制作技能与脚本、源画、部件、绑定、动画和离线配音由同级项目 [dsh-pets-character-studio](../dsh-pets-character-studio/) 管理；本仓接收符合 [CHARACTER-PACK.md](CHARACTER-PACK.md) 的完整人物包。两仓均保留完整的 `tools/character-editor`，本仓用于已有包的编辑、预览与调试。
> 文件卫生目标：**仓库只装重建它所需的最小集合——源码、声明、必要资源；其余留在本机。** 规则由 `.gitignore` 声明、由 `scripts/verify-hygiene.sh` 强制执行，两者必须同步修改。

## 1. 目录约定

| 路径 | 入库 | 说明 |
| --- | :---: | --- |
| `index.js` 及后续运行时源码 | ✅ | Host / Client 实现；当前入口无服务依赖，不注册制作技能 |
| `cordis.patch.yml` `locale/` `icon.svg` | ✅ | 激活补丁与插件显示元数据 |
| `package.json` `pnpm-lock.yaml` `.gitignore` 等声明 | ✅ | 依赖与工具链 |
| `README.md` `README_zh.md` `CONTRIBUTING.md` `AGENTS.md` `CHARACTER-PACK.md` | ✅ | 对外文档、协作约定与人物包交付规范 |
| `scripts/` | ✅ | 本项目构建、校验与发布脚本 |
| `THIRD-PARTY-NOTICES.md` `LICENSE` | ✅ | 来源记录与分离授权：代码 MIT / 默认角色资产 CC BY-NC-SA 4.0 |
| `assets/characters/deepseek/**` | ✅ | 唯一随程序打包的默认人物包 |
| `assets/characters/index.json` | ✅ | 可下载人物包索引 |
| `assets/characters/<其他 id>/**` | ❌ | 其他人物包计划按需下载到用户目录 |
| `tools/character-editor/**` | ✅ | 已有包的完整编辑、预览与调试工具；保留本地源码，不随运行时 npm 包分发 |
| `assets/source/` `tools/part-annotator/` `skills/` 等其余人物制作内容 | ❌ | 归 Studio 管理，不随桌宠运行项目分发 |
| `docs/**` | ❌ | 内部文档、设计稿、调研笔记、PDF / Office 文件仅本地保存 |
| `docs/assets/` 下的扁平图片 | ✅ | 唯一例外：README 引用的图片与截图 |
| `references/` `experiments/` `playground/` `sandbox/` `workspace/`（仓库根） | ❌ | 参考项目、实验、工作现场、模型权重与本机环境 |
| `.agents/` `.dsh/` | ❌ | 本机技能与配置 |
| `node_modules/` `dist/` `build/` `out/` `coverage/` | ❌ | 可重建的依赖与构建产物 |
| `.env*` `*.pem` `*.key` `secrets.json` | ❌ | 凭据与本地配置 |
| `*.log` `tmp/` `*.bak` `.DS_Store` `.idea/` `.vscode/` | ❌ | 日志、临时文件、编辑器与系统垃圾 |

新增文件前先判断能否从源码和依赖重建；可重建的产物不入库。第三方依赖通过依赖声明引入，不把参考仓库整体复制进来；确需复用第三方代码时，只取必要片段并在 `THIRD-PARTY-NOTICES.md` 记录出处、许可证与改动。

## 2. README 图片与体积

`docs/` 整体忽略，唯一白名单是 `docs/assets/` 下的扁平图片：

- 允许 `.png` `.jpg` `.jpeg` `.gif` `.webp` `.svg` `.avif`，不建子目录。
- README 使用相对路径引用，图片名采用体现内容的 kebab-case。
- 图片建议不超过 1 MiB，硬上限 3 MiB；通用单文件上限 5 MiB，角色资源单文件上限 8 MiB，超限需压缩。
- 录屏、带声音的演示、PDF / Office 文件与原始设计稿留在本地；README 动图转为压缩后的 WebP 或 GIF。

## 3. 默认人物包与完整交付

仓库只保留默认包 `assets/characters/deepseek/**` 和下载索引 `assets/characters/index.json`。其他人物包永不入库，计划存放于 `~/.dsh/pets/characters/<id>/`；不要写进安装目录，以免更新覆盖。用户目录优先于内置目录及“重置为内置”属于待实现的运行规则。

Studio 的交付必须是完整人物包，格式以 [CHARACTER-PACK.md](CHARACTER-PACK.md) 为准：

- `manifest.json` 声明身份、版本、渲染入口、状态与动作映射、降级资源和授权信息，所有引用指向包内真实文件。
- 动画导出数据、图集和贴图齐全，预览与静态降级可用；只有拆件贴图或未完成骨架不算交付。
- 声明语音时，语音索引引用的全部预录制音频必须齐全；明确静音的包可不带语音索引。美术、动画与音频共享人物包版本。
- 每包附 `LICENSE` 与 `ATTRIBUTION.md`，记录来源链、未采用内容与修改说明。

包中已有素材不代表桌宠加载、渲染或播放通过验收；涉及能力的描述必须区分已实现与计划。

## 4. 许可证与来源

源代码、脚本与文档采用 MIT；复用上游代码时保留版权与许可证声明。MIT 授权不覆盖 `assets/characters/`。完整条款见根 [LICENSE](LICENSE)。

默认人物包采用 **CC BY-NC-SA 4.0**：保留 上善无形 / 上善（鲸鱼娘原型）、ZipZipPipe（DeepSeek 二次设计）与本项目衍生制作的完整署名链，标明修改，禁止商业用途，演绎贡献按相同许可发布。免费发布不授予商业权利；CC 许可不得附加额外限制，“仅供学习参考”只能作为项目立场。依据：[许可条款](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)与[作者声明](https://www.bilibili.com/opus/1247156596114456581)。

每个角色、贴图和音频都要单独核实授权，不收录厂商官方素材与未获授权的配音，不替第三方授予权利。来源与排除项见默认包的 [ATTRIBUTION.md](assets/characters/deepseek/ATTRIBUTION.md)。品牌主题必须注明非官方，商标归各自权利人所有。

权利人可通过 [Issue](https://github.com/bloodarea/dsh-pets/issues) 提供文件路径与可核实出处，核实后停止分发相关素材；CC 许可不可撤销，此流程不修改已有许可。Spine 运行时与导出动画数据受 Esoteric Software 商业许可约束，新增或发布人物包前需核对适用条款与素材来源。

## 5. 校验与规则变更

```bash
# 每个克隆安装一次 pre-commit 钩子
scripts/install-hooks.sh

# 暂存区 / 全部已跟踪文件
scripts/verify-hygiene.sh
scripts/verify-hygiene.sh --all

# 定位指定路径的违规
scripts/verify-hygiene.sh --files docs/a.md references/x.js
```

提交前必须跑 `scripts/verify-hygiene.sh --all`，不得用 `git add -f` 绕过忽略规则。确认门禁误判才可使用 `--no-verify`，并在 PR 或提交说明记录原因。误入暂存区的本地文件只从索引移除、保留本地；涉及已泄露凭据时先吊销密钥，再处理历史。

规则变更必须同时更新 `.gitignore`、`scripts/verify-hygiene.sh` 和本文件，说明理由，并用 `scripts/verify-hygiene.sh --all` 检查存量文件；提交说明写明影响面。
