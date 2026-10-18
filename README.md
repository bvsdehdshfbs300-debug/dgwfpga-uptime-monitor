# 地瓜丸 FPGA 教学平台监控

这是 `https://dgwfpga.cn` 的独立公网可用性监控，不包含网站源码。

## 监控策略

- GitHub Actions 每 5 分钟从公网检查一次。
- 同时检查首页与 `/api/health`，避免只检测到静态页面。
- 单次任务连续检查两轮，两轮均失败才判定离线。
- 只在“正常 -> 离线”和“离线 -> 恢复”时通过 Server酱推送微信，持续离线时不会重复轰炸。
- 监控状态保存在仓库中标题为 `[monitor-state] dgwfpga.cn` 的 Issue 里。

## 配置

在仓库的 `Settings -> Secrets and variables -> Actions` 中添加：

- `SERVERCHAN_SENDKEY`：Server酱 SendKey，只保存在 GitHub Secret 中。

添加后，在 Actions 页面手动运行一次 `FPGA site uptime monitor`，即可验证网站检查和微信通知。

## 手动测试

```powershell
node scripts/check-site.mjs --dry-run
```

