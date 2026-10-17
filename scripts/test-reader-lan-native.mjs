#!/usr/bin/env node
import { androidBuildEnvironment, androidProjectPath, gradleCommand, run, syncAndroidProject } from './android-tooling.mjs';
const environment = androidBuildEnvironment();
const prebuild = syncAndroidProject(environment);
if (prebuild) process.exit(prebuild);
process.exit(run(gradleCommand(), [':reader-lan-server:testReleaseUnitTest', '-PreactNativeArchitectures=arm64-v8a'], androidProjectPath, environment));
