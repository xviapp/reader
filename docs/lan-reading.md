# 局域网阅读

手机开一个只读的 HTTP 服务，电脑在同一个 Wi-Fi 下用浏览器看手机上的数据。网页文件随 APK
打包，不需要联网。

## 组成

| 部分 | 位置 | 做什么 |
| --- | --- | --- |
| 原生服务 | `modules/reader-lan-server/` | Ktor CIO 服务器、访问码与会话、限流、静态资源和图片 |
| 数据读取 | `src/modules/reader/lan/` | 只读查询、DTO 投影、数据变化通知、生成中回答的转发 |
| 网页 | `web/` | React DOM + Vite，构建产物在 `dist/lan-web/` |

## 开启与停止

- 只在当前 Wi-Fi 的 IPv4 地址上监听，端口从 9527 开始，占用就加一。
- 运行时是一个 `connectedDevice` 类型的前台服务，带通知和「停止」按钮，并持有唤醒锁。
  后台或锁屏后能否继续响应取决于系统的电池策略，设置页提供电池优化的入口。
- Wi-Fi 断开或地址变化时服务自动停止。停止后端口关闭，访问码和所有会话失效。
- 开启状态、端口、访问码都不保存，应用重启后服务是关的。

## 访问控制

- 访问码是 6 位数字，用 `SecureRandom` 生成，每次开启重新生成，只在手机设置页显示。
- 验证通过后发一个 256 bit 的会话 cookie（`HttpOnly; SameSite=Strict`），只在本次服务内有效。
- 输错限流：同一 IP 每分钟 5 次，全局每分钟 30 次，超过后冷却 60 秒。
- 检查 `Host` 必须是本次服务的地址，会话请求还要检查 `Origin`。不开放 CORS。
- 最多 3 个页面同时连接，每个页面一条 SSE 连接。
- 请求大小限制：URL 4 KiB，请求头 8 KiB，请求体 1 KiB；不接受 chunked 请求体。

HTTP 不加密，访问码只用来挡住同一网络里的其他人。停止服务只能阻止之后的访问，
已经显示在浏览器里的内容收不回来。

## 数据

- 所有业务接口都是只读的，只执行 SELECT。可写的只有登录和退出会话。
- 响应里的字段都是逐个挑出来的，不包含本机文件路径、提示词、AI 凭据、内部错误信息和未采纳的整理稿。
- 列表默认每页 50 条，最多 100 条；长消息在列表里截到 2,000 字，打开再读全文。搜索词最多 200 字。
- 图片按 ID 请求。服务端每次都重新检查它属于可见的书或摘录，确认真实路径在 `reader-media`
  目录内，按文件头识别格式，只返回 JPEG、PNG、WebP、GIF。
- 所有响应带 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、
  `Referrer-Policy: no-referrer` 和只允许同源资源的 CSP。
- 网页不用 localStorage、IndexedDB 或 Service Worker，数据只在页面内存里。

## 更新

手机监听相关数据表，变化后通过 SSE 通知网页，网页重新请求当前看到的内容。讨论生成回答时，
增量文本也通过 SSE 推送；回答保存到数据库后，网页以保存的结果为准。

连接断开时网页保留已经加载的内容并标出可能过期，按退避重连（最长 15 秒一次）；
15 秒收不到心跳就算断线。

## 实机检查脚本

`scripts/probe-reader-lan-device.mjs` 在连着 adb 的手机上做 HTTP 检查，只输出状态、计数和耗时，
不输出访问码、cookie 或书籍内容。运行前先解锁手机。

```bash
node scripts/probe-reader-lan-device.mjs --start                      # 打开设置页并开启服务
node scripts/probe-reader-lan-device.mjs --home --delay-ms=30000      # 切到桌面后连接
node scripts/probe-reader-lan-device.mjs --lock --delay-ms=30000      # 熄屏后连接
node scripts/probe-reader-lan-device.mjs --start --http-boundaries --stop
```

`--http-boundaries` 加测请求大小和格式的限制，`--stop` 检查停止后端口是否关闭（不能和 `--lock`
同用）。`--lock --doze` 会强制设备进入 Doze，结束时恢复。

桌面上跑一次大数据量查询（100 本书、1 万条摘录、5 万条消息，桌面 SQLite，不代表手机性能）：

```bash
READER_LAN_SCALE=1 pnpm exec vitest run tests/reader-lan-data.test.ts
```
