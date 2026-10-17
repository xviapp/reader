import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const sdk = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
const adbPath = sdk ? join(sdk, 'platform-tools/adb') : 'adb';

export function androidCommand(...args) {
  return execFileSync(adbPath, args, { encoding: 'utf8', timeout: 15000 });
}

/** UI dumps may contain a LAN access code: read in memory and remove immediately. */
export function readAndroidUi() {
  const temporary = '/data/local/tmp/reader-lan-probe.xml';
  try {
    androidCommand('shell', 'uiautomator', 'dump', temporary);
    return androidCommand('exec-out', 'cat', temporary);
  } finally { androidCommand('shell', 'rm', '-f', temporary); }
}

export function tapAndroidControl(xml, label) {
  const nodes = [...xml.matchAll(/<node\b[^>]*>/gu)].map((match) => match[0]);
  for (const node of nodes) {
    if (!node.includes(`text="${label}"`) && !node.includes(`content-desc="${label}"`)) continue;
    if (!node.includes('enabled="true"')) continue;
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u.exec(node);
    if (!bounds || Number(bounds[3]) <= Number(bounds[1]) || Number(bounds[4]) <= Number(bounds[2])) continue;
    const x = Math.round((Number(bounds[1]) + Number(bounds[3])) / 2);
    const y = Math.round((Number(bounds[2]) + Number(bounds[4])) / 2);
    androidCommand('shell', 'input', 'tap', String(x), String(y));
    return;
  }
  throw new Error(`找不到可用控件：${label}`);
}

/** Focus the named control before Enter; do not infer a successful press from coordinates. */
export function activateAndroidControl(xml, label) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const nodes = [...xml.matchAll(/<node\b[^>]*>/gu)].map((match) => match[0]);
    const matches = nodes.filter((node) => node.includes(`text="${label}"`) || node.includes(`content-desc="${label}"`));
    if (!matches.some((node) => node.includes('enabled="true"'))) {
      throw new Error(`找不到可用控件：${label}；请确认手机已解锁并停留在局域网阅读页`);
    }
    if (matches.some((node) => node.includes('focused="true"'))) {
      const started = performance.now();
      androidCommand('shell', 'input', 'keyevent', '66');
      return started;
    }
    androidCommand('shell', 'input', 'keyevent', '61');
    xml = readAndroidUi();
  }
  throw new Error(`无法聚焦控件：${label}`);
}
