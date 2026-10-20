#!/bin/zsh
# qq-bridge 控制中心（macOS）：双击在「终端」里打开，和 Windows 的 control-center.bat 对应。
# 不会自己启动桥接、接口平台或 NapCat —— 用页面上的按钮。关掉这个终端窗口 = 退出控制中心及其启动的进程。
#
# 为什么要从「终端」启动：NapCat 的配置在 QQ 的沙盒容器里（~/Library/Containers/com.tencent.qq），
# macOS 会把读取它算在「启动控制中心的程序」头上并询问「访问其他 App 的数据」。从终端启动只需给终端授权一次。
cd "${0:A:h}" || exit 1
# 双击启动的终端不一定加载了 Homebrew 的 PATH
for p in /opt/homebrew/bin /opt/homebrew/opt/node@22/bin /usr/local/bin; do [[ -d $p ]] && PATH="$p:$PATH"; done
export PATH
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "[qq-bridge] 没有找到 Node.js。请先安装 Node.js 22（例如 brew install node@22），再重新双击本文件。"
  echo
  read -k1 "?按任意键关闭…"
  exit 1
fi
node src/launcher/control-center.mjs "$@"
code=$?
if (( code != 0 )); then read -k1 "?控制中心异常退出（$code），按任意键关闭…"; fi
exit $code
