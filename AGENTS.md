# reader Agent Guide

这是独立 Android 应用「阅读」（`app.xvi.reader`）的源码仓库；本文件定义本仓库的代码边界与工作流。

## 本地代码边界

- 应用行为放在 `src/modules/**`、`src/core/app-config.ts` 或本地 adapter 中。
- 数据库、媒体、OCR、AI 任务和局域网阅读能力必须能在本仓库内独立安装、测试、构建和发布。

## 工作流

- 安装依赖：`pnpm install`。
- 连接一个已授权 Android 设备并直接构建安装：`pnpm install:android`。
- 常用验证：`pnpm check:independence`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- Android 原生检查：`pnpm check:android-native`；release APK 使用 `pnpm build:android-apk:arm64` 或 `pnpm build:android-apk:emulator`。
- `android/`、`node_modules/`、`.artifacts/` 和构建缓存均为生成物，不提交。

## 变更与提交

- 保留用户已有修改，修改前检查本仓库状态。
- 只有用户明确要求时才提交；提交前运行与变更相关的验证。
- 应用适配通过本地窄接口或 adapter 完成；同步副本的变更遵循下述边界。

## 同步副本

以下文件同步自上游共享包，上游不在本仓库内。不要直接编辑、格式化或在其中加入应用专属补丁；
需要修改时在上游完成后再同步，上游不可用时报告缺失信息，不以修改副本代替源头修复。
应用专属行为放在本地业务模块、配置或 adapter 中。

| 本项目文件 | 上游 |
| --- | --- |
| `src/core/ai/ai-engine.ts` | `ai` 包 |
| `src/core/ai/ai-settings-core.ts` | `ai` 包 |
| `src/core/ai/direct-ai-adapter.ts` | `ai` 包 |
| `src/core/ai/ai-response-state.ts` | `ai` 包 |
| `src/core/ui/branded-startup-splash.tsx` | `startup` 包 |
| `src/core/design/brand-theme.ts` | `theme` 包 |
| `src/core/ui/brand-illustration.tsx` | `theme` 包 |
| `src/core/design/brand-artwork.ts`、`assets/brand/illustrations/*-paper-v1.png` | `theme` 包 |

- `src/core/ai/` 的其余文件（如 `ai-settings.native.ts`、`ai-task-runner.ts`、`ai-task-schema.ts`、`native-ai-execution.ts`）由本仓库维护。
- 本地 adapter：`src/core/ui/startup-splash-content.tsx`（图片、应用名和标语）、`startup-shell.tsx`（启动生命周期）、`src/core/design/tokens.ts`（品牌选择与 `brandIdentity`）。
- 其余文件不能仅因与其他应用同名或内容相似就视为同步副本。新增或迁移同步文件时更新本表。
- 安装、测试、构建和发布只使用仓库内文件，不引入跨项目源码导入、`workspace:`、`file:`、`link:` 依赖或指向外部源码的符号链接。
