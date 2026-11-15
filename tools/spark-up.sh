#!/usr/bin/env bash
# Spark 一键接通：起 SSH 隧道 → 等 Ollama 就绪 → 校验模型在线 → 提示开游戏。
#
# 分工（本脚本只做「拉起 + 等待 + 自检」，不碰游戏、不碰隧道本体）：
#   隧道本体 = spark-tunnel.sh（掉线自动重连的那层 while 循环，由它负责）；
#   本脚本负责把它拉到后台、等 <配置的端口>/api/tags 通、然后拿
#   .env.local 里配的模型去 /api/tags 里对账——不在就明说，不静默放行。
#
# 用法：
#   tools/spark-up.sh           起隧道（端口已在听则跳过）并自检
#   tools/spark-up.sh --check   不起隧道，只自检当前状态
#   tools/spark-up.sh --stop    停掉本脚本拉起的隧道（含其 ssh 子进程）
#
# 环境变量（均有默认；覆盖仅用于测试或多环境）：
#   SPARK_TUNNEL_SH  隧道脚本路径       默认：自动探测（当前仓库，再主线仓库）
#   SPARK_UP_ENV     .env.local 路径    默认：自动探测（当前仓库，再主线仓库）
#   SPARK_UP_URL     探测的 Ollama 地址 默认：.env.local 的 VITE_OLLAMA_URL
#   SPARK_UP_WAIT    等端口就绪的秒数   默认：40
#
# 退出码：0 = 可以开游戏了；1 = 没通（原因全部打在屏幕上，不静默）。

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 主线仓库定位：agent worktree（…/agent-worktrees/ag-xx/）与主线 checkout
# 是同一个 git 的两个工作树，隧道脚本与 .env.local 都只该在主线那一份。
# 用 git-common-dir 精确定位（不猜层级），失败再退回逐级猜。
main_repo_of() {
  local common
  common="$(git -C "$1" rev-parse --git-common-dir 2>/dev/null || true)"
  if [[ -n "$common" ]]; then
    case "$common" in /*) ;; *) common="$1/$common" ;; esac
    if [[ -d "$common" ]]; then (cd "$common/.." && pwd); return; fi
  fi
  local up="$1" i
  for i in 1 2 3 4; do
    up="$(cd "$up/.." && pwd)"
    [[ -f "$up/spark-tunnel.sh" || -f "$up/.env.local" ]] && { echo "$up"; return; }
  done
  echo ""
}
MAIN_REPO="$(main_repo_of "$REPO_ROOT")"

RUNDIR="$REPO_ROOT/output/spark-up"
mkdir -p "$RUNDIR"
LOG="$RUNDIR/tunnel.log"
PIDFILE="$RUNDIR/tunnel.pid"

die() { echo "spark-up: $*" >&2; exit 1; }

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ── --stop：收尾本脚本拉起的隧道（父进程 + ssh 子进程，不留孤儿） ──────────
# pidfile 只覆写不删除：stale 的（进程已死）靠 kill -0 探活识别，
# 报一句「已经没了」就行——删文件在某些环境里比杀进程还容易出岔子。

stop_tunnel() {
  local pid children
  if [[ -f "$PIDFILE" ]]; then
    pid="$(cat "$PIDFILE" 2>/dev/null)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      # ssh 是隧道脚本的子进程：先收子，再收父，否则 ssh -N 会成孤儿继续占着端口。
      # 注意用 ps -ef（本机 Git Bash 的 ps 不支持 -o）：$2 是 PID、$3 是 PPID。
      children="$(ps -ef 2>/dev/null | awk -v p="$pid" '$3==p {print $2}')"
      [[ -n "$children" ]] && kill $children 2>/dev/null
      kill "$pid" 2>/dev/null
      echo "spark-up: 隧道已停（pid $pid）"
    else
      echo "spark-up: 没有在跑的隧道（pidfile 里的 pid ${pid:-空} 已经不存在）"
    fi
  else
    echo "spark-up: 没有本脚本拉起的隧道（$PIDFILE 不存在）。手动跑的 spark-tunnel.sh 请到它的窗口 Ctrl+C。"
  fi
}

# 参数分发放在读 .env.local 之前：--help/--stop/参数写错都不该被
# 「没配模型」挡在门外——停隧道和看用法本来就不需要模型配置。
case "${1:-}" in
  --help | -h) usage; exit 0 ;;
  --stop) stop_tunnel; exit 0 ;;
  --check | "") ;;
  *) die "未知参数「$1」。用法：tools/spark-up.sh [--check|--stop]" ;;
esac

# ── .env.local 定位与取值 ──────────────────────────────────────────────────

ENV_FILE="${SPARK_UP_ENV:-}"
if [[ -z "$ENV_FILE" ]]; then
  for c in "$REPO_ROOT/.env.local" "$MAIN_REPO/.env.local"; do
    [[ -f "$c" ]] && ENV_FILE="$c" && break
  done
fi
[[ -n "$ENV_FILE" && -f "$ENV_FILE" ]] || die "找不到 .env.local（找过：$REPO_ROOT/.env.local、$MAIN_REPO/.env.local；可用 SPARK_UP_ENV 指定）。AI NPC 是显式 opt-in：复制一份 .env.local 并配上 VITE_NPC_MODEL 再跑本脚本。"

# 取 KEY=VALUE：容忍空白、引号与行尾注释；多次赋值取最后一次（与 Vite 一致）。
env_from_file() {
  local key="$1" val
  val="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2-)"
  val="${val%%#*}"
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  printf '%s' "$val"
}

MODEL="$(env_from_file VITE_NPC_MODEL)"
[[ -n "$MODEL" ]] || die ".env.local（$ENV_FILE）里没有配 VITE_NPC_MODEL——没有模型名时 AI 整条路径关闭，起了隧道也没意义。先配上再跑。"

URL="${SPARK_UP_URL:-$(env_from_file VITE_OLLAMA_URL)}"
URL="${URL:-http://127.0.0.1:11434}"
URL="${URL%/}"

# URL 里的端口就是游戏要连的本地端口；隧道脚本用 LOCAL_PORT 开对应端口，
# 两边永远一致（.env.local 配 11435 也不再对不上）。
PORT="${URL##*:}"
[[ "$PORT" =~ ^[0-9]+$ ]] || PORT=11434

WAIT="${SPARK_UP_WAIT:-40}"

command -v curl >/dev/null 2>&1 || die "需要 curl（Git for Windows 自带）。"
command -v node >/dev/null 2>&1 || die "需要 node（跑 /api/tags 的 JSON 解析）。"

# --noproxy：隧道永远在本机回路里，公司代理/沙箱代理都不该插一脚——
# 否则代理对死端口回的 502 错误页会被误判成「通了」。
probe_tags() { curl -s -m 3 --noproxy '*' "$URL/api/tags"; }

# ── 起隧道（端口已在听则跳过；本机 Ollama 在跑时也会停在「已在听」） ────────

if [[ "${1:-}" != "--check" ]]; then
  if TAGS_NOW="$(probe_tags 2>/dev/null)" && [[ -n "$TAGS_NOW" ]]; then
    echo "spark-up: $URL 已在监听（隧道已在跑，或本机 Ollama 占着 $PORT）——跳过启动，直接校验模型。"
  else
    TUNNEL="${SPARK_TUNNEL_SH:-}"
    if [[ -z "$TUNNEL" ]]; then
      for c in "$REPO_ROOT/spark-tunnel.sh" "$MAIN_REPO/spark-tunnel.sh"; do
        [[ -f "$c" ]] && TUNNEL="$c" && break
      done
    fi
    [[ -n "$TUNNEL" && -f "$TUNNEL" ]] || die "找不到 spark-tunnel.sh（找过：$REPO_ROOT/spark-tunnel.sh、$MAIN_REPO/spark-tunnel.sh；可用 SPARK_TUNNEL_SH 指定）。隧道本体不在本仓库，别绕开它自己拼 ssh。"

    # 上一次拉起的隧道还在跑就先收掉，避免重复隧道互相抢端口。
    stop_tunnel

    echo "spark-up: 拉起隧道（$TUNNEL，本地端口 $PORT）……"
    LOCAL_PORT="$PORT" nohup bash "$TUNNEL" >"$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    echo "spark-up: 隧道 pid $(cat "$PIDFILE")，日志 $LOG（掉线重连由隧道脚本自己的 while 循环负责）"
  fi
fi

# ── 等端口 ────────────────────────────────────────────────────────────────

TAGS=""
for ((i = 1; i <= WAIT; i++)); do
  if TAGS="$(probe_tags 2>/dev/null)" && [[ -n "$TAGS" ]]; then break; fi
  TAGS=""
  sleep 1
done

if [[ -z "$TAGS" ]]; then
  {
    echo "spark-up: 等了 ${WAIT}s，$URL/api/tags 仍不通。"
    if [[ "${1:-}" != "--check" && -f "$PIDFILE" ]]; then
      echo "spark-up: 隧道还起着（pid $(cat "$PIDFILE" 2>/dev/null)）——排查完可再跑 tools/spark-up.sh --check，或 tools/spark-up.sh --stop 停掉。"
    fi
    echo "spark-up: 隧道日志末尾（$LOG）："
    tail -n 8 "$LOG" 2>/dev/null | sed 's/^/    /' || echo "    （无日志）"
    echo "spark-up: 排查建议："
    echo "    1) 手动连一次：ssh -i ~/.ssh/spark_ed25519 -p 6083 Developer@106.13.186.155"
    echo "    2) 或直接前台跑隧道看输出：bash \"${TUNNEL:-spark-tunnel.sh}\""
    echo "    3) Spark 那头的 Ollama 要起着（ollama serve）。"
  } >&2
  exit 1
fi

# ── 校验模型真的在 Spark 上 ───────────────────────────────────────────────

MODELS="$(printf '%s' "$TAGS" | node -e '
  let raw = "";
  process.stdin.on("data", (c) => { raw += c; });
  process.stdin.on("end", () => {
    let data;
    try { data = JSON.parse(raw); } catch { process.exit(3); }
    const names = Array.isArray(data && data.models)
      ? data.models.map((m) => m && m.name).filter((n) => typeof n === "string")
      : [];
    process.stdout.write(names.join("\n"));
  });
')" || die "$URL 通了，但 /api/tags 不是合法 JSON——那头可能不是 Ollama。"

if ! printf '%s\n' "$MODELS" | grep -Fxq "$MODEL"; then
  {
    echo "spark-up: Spark 上没有模型「$MODEL」（$ENV_FILE 的 VITE_NPC_MODEL）。"
    echo "spark-up: 现在在线的是："
    if [[ -n "$MODELS" ]]; then printf '%s\n' "$MODELS" | sed 's/^/    /'; else echo "    （一个都没有）"; fi
    echo "spark-up: 处理：把 VITE_NPC_MODEL 改成上面其中一个，或先上 Spark 拉模型。"
  } >&2
  exit 1
fi

echo "spark-up: $URL 就绪，模型 $MODEL 在线。"
echo "spark-up: 可以开游戏了（npm run dev，然后找 2 层的阿林/小周对话）。"
exit 0
