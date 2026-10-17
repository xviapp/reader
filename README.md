# 阅读

阅读（`app.xvi.reader`）是一个 Android 读书笔记应用。拍下书页，在手机上做 OCR，
整理成摘录，再围绕书或某段摘录和 AI 讨论。所有数据都存在手机本地。

## 功能

- 书架：书籍资料、封面、阅读状态和页数进度。
- 摘录：拍照或从相册选图，本地 OCR 识别文字。OCR 原文单独保留，整理后的文字可以编辑。
- AI：整理摘录、生成摘要和问题建议，按书或摘录开讨论。AI 服务在 **设置 → AI 服务**
  里自己配置，请求从手机直接发给你选的服务，密钥存在 Android 安全存储里。
- 阅读计时：书籍页点「开始阅读」开始计时，计时期间有常驻通知。结束时填页码，进度跟着更新，
  同时保存一条阅读记录；不到 1 分钟的不记。计时存在本机，应用重启后还在。
- 局域网阅读：在电脑浏览器里只读浏览手机上的书和讨论，见下文。
- 分享与导出：摘录、OCR 原文、AI 回答可以通过系统分享菜单发出去，书籍可以导出。
- 备份与恢复。

更新记录见 [release-notes.md](docs/releases/release-notes.md)。

## 局域网阅读

手机上打开 **设置 → 局域网阅读** 并开启，电脑连同一个 Wi-Fi，用 Chrome 或 Edge 打开手机上
显示的地址，输入 6 位访问码。端口从 `9527` 开始，被占用就往后加一，以手机上显示的为准。

网页能看书架、书籍、摘录（图片、OCR、摘要、问题建议）、讨论、文件夹和收藏，也能搜索。
网页是只读的：不能编辑，也不能发起 AI 或 OCR。手机上保存的改动会自动推到网页，
讨论正在生成的回答也会实时显示。最多同时开三个页面。

停止服务后访问码作废，再次开启会换新的。网页内容只放在页面内存里，刷新后重新从手机读取。
协议和安全细节见 [docs/lan-reading.md](docs/lan-reading.md)。

## 开发

需要 Node.js 22+、pnpm 10、JDK 17+ 和 Android SDK（用 `ANDROID_SDK_ROOT` 或 `ANDROID_HOME`
指定）。只支持 Android。

```bash
pnpm install
pnpm start             # Expo 开发服务器
pnpm android           # 构建 debug 版并运行
pnpm install:android   # 构建 release APK 并安装到已连接的设备
pnpm check             # 全部检查：lint、类型、测试、构建
```

`pnpm install:android` 按设备 ABI 构建，然后 `adb install -r`。可以用
`--device=<serial>` 指定设备，`--skip-build` 复用 `.artifacts/android/` 里已有的 APK，
`--dry-run` 只打印计划。

单独构建 release APK：

```bash
pnpm build:android-apk:arm64
pnpm build:android-apk:emulator
```

构建脚本会把 `package.json` 和 `app.json` 里的版本号和 `versionCode` 加一。

### 签名

没配签名时，release APK 用 Expo 模板自带的 debug keystore，只适合自己测试。要用自己的
keystore，设置下面几个环境变量（也可以写进 `~/.gradle/gradle.properties`）：

```bash
export READER_RELEASE_STORE_FILE=/absolute/path/to/release.jks
export READER_RELEASE_STORE_PASSWORD=...
export READER_RELEASE_KEY_ALIAS=...
export READER_RELEASE_KEY_PASSWORD=...
```

换了签名的 APK 不能覆盖安装旧签名的版本，要先卸载，本地数据也会一起清掉。

### 局域网网页

网页在 `web/` 下，用 Vite 构建到 `dist/lan-web/`，打包进 APK，电脑上不需要跑开发服务器。
`pnpm build` 和 Gradle 构建都会重新生成并校验这些文件。

```bash
pnpm typecheck:web
pnpm lint:web
pnpm test:web
pnpm build:web
pnpm test:lan-native
```

## 许可证

[MIT](LICENSE)
