#!/usr/bin/env bash
# ===========================================================================
# dsh-pets 提交卫生检查：把 .gitignore 的约定升级为硬性门禁。
#
# 用法：
#   scripts/verify-hygiene.sh               # 检查暂存区（pre-commit 钩子调用）
#   scripts/verify-hygiene.sh --all         # 检查全部已跟踪文件（CI / 发布前）
#   scripts/verify-hygiene.sh --files a b   # 检查指定路径（手工排查）
#   scripts/verify-hygiene.sh -h            # 帮助
#
# 退出码：0 通过；1 存在违规；2 环境错误。
# 规则正文见 CONTRIBUTING.md § 文件卫生规则。本脚本是 .gitignore 的“第二道锁”，
# 二者必须同时成立：即便有人用 git add -f 强推，这里也会拦下来。
# ===========================================================================
set -uo pipefail

MAX_FILE_MIB=5    # 单文件硬上限
MAX_IMAGE_MIB=3   # docs/assets 图片更严，README 加载速度优先

RED=''; GRN=''; YEL=''; RST=''
if [ -t 1 ]; then RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'; fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "错误：当前目录不在 git 仓库内。" >&2; exit 2;
}
cd "$repo_root" || exit 2

mode=staged
files=()

while [ $# -gt 0 ]; do
  case "$1" in
    --all)    mode=all; shift ;;
    --files)  shift; mode=files; files=("$@"); break ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "未知参数：$1（用 -h 查看用法）" >&2; exit 2 ;;
  esac
done

if [ "$mode" = staged ]; then
  while IFS= read -r f; do [ -n "$f" ] && files+=("$f"); done \
    < <(git diff --cached --name-only --diff-filter=ACMR)
elif [ "$mode" = all ]; then
  while IFS= read -r f; do [ -n "$f" ] && files+=("$f"); done < <(git ls-files)
fi

total=${#files[@]}
if [ "$total" -eq 0 ]; then
  echo "${GRN}卫生检查通过${RST}：无待检查文件。"
  exit 0
fi

violations=0
blocked_lines=()
warn_lines=()

# 记录一条违规：$1 路径，$2 命中的规则说明
block() {
  violations=$((violations + 1))
  blocked_lines+=("$(printf '  %s✗%s %s\n      └─ %s' "$RED" "$RST" "$1" "$2")")
}
warn() { warn_lines+=("$(printf '  %s!%s %s\n      └─ %s' "$YEL" "$RST" "$1" "$2")"); }

# README 唯一允许入库的 docs 资源：docs/assets/ 下的扁平图片
is_docs_asset() {
  case "$1" in
    docs/assets/*.png|docs/assets/*.jpg|docs/assets/*.jpeg|docs/assets/*.gif|\
    docs/assets/*.webp|docs/assets/*.svg|docs/assets/*.avif)
      # 必须是扁平文件，不允许子目录
      case "${1#docs/assets/}" in */*) return 1 ;; *) return 0 ;; esac ;;
    *) return 1 ;;
  esac
}

# 取文件字节数：优先索引/HEAD 中的 blob（能查尚未检出的删除场景）
blob_size() {
  local p=$1 s=''
  if [ "$mode" = staged ]; then s=$(git cat-file -s ":$p" 2>/dev/null)
  else s=$(git cat-file -s "HEAD:$p" 2>/dev/null); fi
  [ -n "$s" ] || s=$(wc -c < "$p" 2>/dev/null)
  printf '%s' "${s:-0}"
}

human() { awk -v b="$1" 'BEGIN{printf (b>=1048576? "%.1f MiB" : "%.0f KiB"), (b>=1048576? b/1048576 : b/1024)}'; }

for f in "${files[@]}"; do
  case "$f" in
    # --- 规则 1：本地参考 / 实验目录 ---
    references/*|reference/*|experiments/*|playground/*|sandbox/*)
      block "$f" "本地参考项目与实验目录不入库（体积大、第三方代码、许可证风险）"; continue ;;
    # --- 规则 2：docs 只放 README 用图 ---
    docs/*)
      if ! is_docs_asset "$f"; then
        block "$f" "docs/ 内部文档不入库；README 需要的图片放 docs/assets/ 下的扁平图片文件"
        continue
      fi ;;
    # --- 规则 3：依赖与构建产物 ---
    node_modules/*|.pnpm-store/*|dist/*|build/*|out/*|coverage/*|.vite/*|.turbo/*|.cache/*|*.tsbuildinfo)
      block "$f" "依赖 / 构建产物不入库（由安装与构建流程重建）"; continue ;;
    # --- 规则 4：凭据与本地配置 ---
    *.pem|*.key|*.p12|*.pfx|secrets.json|local.config.json)
      block "$f" "凭据类文件严禁入库"; continue ;;
    .env|.env.*)
      [ "$f" = ".env.example" ] || { block "$f" "环境变量文件严禁入库（可提交 .env.example 模板）"; continue; } ;;
    # --- 规则 5：日志、临时、备份 ---
    *.log|logs/*|npm-debug.log*|yarn-error.log*|pnpm-debug.log*|tmp/*|.tmp/*|scratch/*|\
    *.bak|*.orig|*.rej)
      block "$f" "日志 / 临时 / 备份文件不入库"; continue ;;
    # --- 规则 6：编辑器与系统垃圾 ---
    .DS_Store|Thumbs.db|desktop.ini|.idea/*|.vscode/*|*.swp|*.swo|*~)
      block "$f" "编辑器 / 操作系统产生的垃圾文件不入库"; continue ;;
  esac

  # --- 规则 7：体积门禁 ---
  [ -f "$f" ] || continue
  size=$(blob_size "$f")
  [ "$size" -gt 0 ] 2>/dev/null || continue
  if is_docs_asset "$f"; then
    if [ "$size" -gt $((MAX_IMAGE_MIB * 1048576)) ]; then
      block "$f" "README 图片超过 ${MAX_IMAGE_MIB} MiB（$(human "$size")）：请压缩或降分辨率"
    elif [ "$size" -gt 1048576 ]; then
      warn "$f" "README 图片偏大（$(human "$size")），建议压到 1 MiB 以内"
    fi
  else
    if [ "$size" -gt $((MAX_FILE_MIB * 1048576)) ]; then
      block "$f" "单文件超过 ${MAX_FILE_MIB} MiB（$(human "$size")）：改用外部资源或发布制品"
    fi
  fi
done

echo "== dsh-pets 提交卫生检查 =="
echo "模式：$mode    待检查文件：$total"
echo

if [ "$violations" -eq 0 ]; then
  if [ ${#warn_lines[@]} -gt 0 ]; then
    printf '%s\n' "${warn_lines[@]}"
    echo
  fi
  echo "${GRN}✓ 通过${RST}：未发现违反文件卫生规则的文件。"
  exit 0
fi

printf '%s\n' "${blocked_lines[@]}"
[ ${#warn_lines[@]} -gt 0 ] && { echo; printf '%s\n' "${warn_lines[@]}"; }
echo
echo "${RED}✗ 发现 ${violations} 处违规，已阻止提交。${RST}"
echo "  处理方式：git rm --cached <路径>（保留本地文件）后重新提交。"
echo "  确属误判才可用 git commit --no-verify 绕过，并在 CONTRIBUTING.md 记录原因。"
exit 1
