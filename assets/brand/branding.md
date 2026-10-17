# 品牌素材

- `splash-icon.png`：完整插画，用在原生启动页，132dp，contain 缩放，能放进 Android 启动页 192dp
  的安全圆里（132 × √2 < 192）。
- `icon.png`：桌面图标。插画四周的背景用 AI 图像生成扩展过，中间主体没动；从中间截 684px，缩放到 1024px。
- `icon-foreground.png`：自适应图标前景，1024px，不透明，中心主体 592px，背景铺到边缘。
  不要在 config plugin 里再加一层内边距。
- `illustrations/*-paper-v1.png`：空状态和读完状态的纸艺插画，由主题同步脚本维护。
- 桌面图标背景色 `#F7EBD3`，启动页背景色 `#F9EFE2`。

启动动画：先显示 132dp 的原生启动图，2048ms 内渐变到完整插画和应用名、标语；
应用就绪后 220ms 淡出。系统开启减少动画时跳过动画。

参考：[更改应用图标](https://developer.android.com/codelabs/basic-android-kotlin-compose-training-change-app-icon)、
[启动画面](https://developer.android.com/develop/ui/views/launch/splash-screen)
