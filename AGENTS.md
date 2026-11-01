# AGENTS.md

给在本仓工作的 AI 代理（含 DSH 会话）的硬性约定。规则正文见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 三条铁律

1. **`docs/` 不入库**，唯一例外是 README 用图：`docs/assets/` 下的扁平图片（png/jpg/jpeg/gif/webp/svg/avif）。文档、设计稿、笔记、PDF/Office 文件一律留在本地。
2. **`references/` `experiments/` `playground/` `sandbox/` 不入库**——参考项目源码、技术实验、验证脚本只在本机存在。需要引用第三方代码就重写，或落 `THIRD-PARTY-NOTICES.md` 记录出处。
3. **产物与凭据不入库**：`node_modules/` `dist/` `build/` `coverage/`、`.env*`、`*.pem` `*.key`、`*.log`、编辑器/系统垃圾文件。

## 收尾动作

- 提交前跑 `scripts/verify-hygiene.sh --all`；pre-commit 钩子（`scripts/install-hooks.sh` 安装）也会拦。
- 不用 `git add -f` 绕过忽略规则；确属误判才 `--no-verify`，并在提交说明写原因。
- 新增任何文件前先问一句：**它能否从源码/依赖重建？** 能，就不入库。
- 规则要改：`.gitignore` 与 `scripts/verify-hygiene.sh` 必须同步修改。
