#!/usr/bin/env bash
# 主逻辑
# 从仓库根目录启动前后端，任一服务退出或脚本停止时清理两组进程。
set -e

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

for command in node npm uv; do
  if ! command -v "$command" >/dev/null; then
    printf '请先安装 %s。\n' "$command" >&2
    exit 1
  fi
done

# 第一步，首次启动时安装前端依赖。后端依赖由 uv run 按锁文件同步。
if [[ ! -x apps/voice-web/node_modules/.bin/vite ]]; then
  npm --prefix apps/voice-web ci
fi

# 第二步，为前后端分别创建进程组，退出时也能关闭 Vite 和 Uvicorn 的子进程。
set -m
app_pids=()
stop_apps() {
  local pid
  local deadline=$((SECONDS + 8))
  for pid in "${app_pids[@]}"; do
    kill -TERM -- "-$pid" 2>/dev/null || true
  done

  # npm 可能先于 Vite 退出。等待整个进程组释放端口，给 Uvicorn 留出正常关闭的时间。
  for pid in "${app_pids[@]}"; do
    while kill -0 -- "-$pid" 2>/dev/null; do
      if (( SECONDS >= deadline )); then
        kill -KILL -- "-$pid" 2>/dev/null || true
        break
      fi
      sleep 0.1
    done
  done
  wait
}
trap stop_apps EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

uv run --locked --project apps/voice-agent-api python -m voice_agent --reload &
api_pid=$!
app_pids+=("$api_pid")

npm --prefix apps/voice-web run dev &
web_pid=$!
app_pids+=("$web_pid")

# 第三步，兼容 macOS 自带的 Bash。任一服务退出后返回它的状态，并关闭另一个服务。
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 0.2
done

if kill -0 "$api_pid" 2>/dev/null; then
  wait "$web_pid"
else
  wait "$api_pid"
fi
