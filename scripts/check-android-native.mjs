#!/usr/bin/env node

import {
  androidBuildEnvironment,
  androidProjectPath,
  gradleCommand,
  run,
  syncAndroidProject,
} from './android-tooling.mjs';

const environment = androidBuildEnvironment();
if (environment.ANDROID_SDK_ROOT) console.log(`Android SDK: ${environment.ANDROID_SDK_ROOT}`);

const prebuildStatus = syncAndroidProject(environment);
if (prebuildStatus !== 0) process.exit(prebuildStatus || 1);

const compileStatus = run(
  gradleCommand(),
  [':app:compileReleaseKotlin', '-PreactNativeArchitectures=arm64-v8a'],
  androidProjectPath,
  environment,
);
process.exit(compileStatus);
