#!/bin/zsh
cd "${0:A:h}"
interrupted=0
trap 'interrupted=1' INT
node server.mjs
exit_code=$?
trap - INT

if (( interrupted == 1 || exit_code == 0 || exit_code == 130 )); then
  print "\nGMGN 本地分析服务已停止。"
else
  print "\nGMGN 本地分析服务异常退出，状态码：${exit_code}"
fi
print "输入 ./start.command 可重新启动；输入 exit 可关闭此终端窗口。\n"

# 双击 .command 时 Terminal 会在外层追加 exit，因此这里接管为交互式 Shell。
exec /bin/zsh -l
