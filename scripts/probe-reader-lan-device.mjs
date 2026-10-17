#!/usr/bin/env node
/** M0 integration probe. Secrets and business content stay in this process, never stdout. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { createParser } from 'eventsource-parser';
import { androidCommand as adb, readAndroidUi as ui, tapAndroidControl as tap, activateAndroidControl as activate } from './android-reader-ui.mjs';
import { checkNativeHttpBoundaries } from './reader-lan-http-probe.mjs';
import { AndroidReaderDoze } from './android-reader-doze.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const soakOption = process.argv.find((value) => value.startsWith('--soak-minutes='));
const soakMinutes = soakOption ? Number(soakOption.split('=')[1]) : 0;
assert.ok(Number.isInteger(soakMinutes) && soakMinutes >= 0 && soakMinutes <= 120, '--soak-minutes 需要 0..120 的整数');
if (soakMinutes) assert.ok(process.argv.includes('--lock'), '持续测试必须与 --lock 同用');
const requireUnplugged = process.argv.includes('--require-unplugged');
const batteryLevel = () => {
  const battery = adb('shell', 'dumpsys', 'battery');
  assert.ok(!battery.includes('UPDATES STOPPED'), '不能使用模拟电池状态作为验收');
  if (requireUnplugged) assert.ok(!/powered:\s*true/u.test(battery), '非充电验收需要实际断开供电');
  return Number(/\blevel:\s*(\d+)/u.exec(battery)?.[1]);
};
const initialBatteryLevel = batteryLevel();
if (process.argv.includes('--stop') && process.argv.includes('--lock')) throw new Error('--stop 需要已解锁的手机，不能与 --lock 同用');
if (process.argv.includes('--doze') && !process.argv.includes('--lock')) throw new Error('--doze 必须与 --lock 同用');
if (process.argv.includes('--doze-ignore-upcoming-alarm') && !process.argv.includes('--doze')) throw new Error('--doze-ignore-upcoming-alarm 必须与 --doze 同用');
let forcedDoze = false;
const doze = new AndroidReaderDoze();
process.once('exit', () => doze.dispose());
process.once('SIGINT', () => process.exit(130));
process.once('SIGTERM', () => process.exit(143));

if (process.argv.includes('--start')) adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', 'xvi-reader://settings/lan', 'app.xvi.reader');
let xml = ui();
if (process.argv.includes('--start')) {
  activate(xml, '开启局域网阅读');
  await delay(1200);
  xml = ui();
  if (xml.includes('text="始终允许"')) { tap(xml, '始终允许'); await delay(1200); xml = ui(); }
  else if (xml.includes('permission_allow_button')) { tap(xml, '允许'); await delay(1200); xml = ui(); }
  if (!xml.includes('content-desc="访问码 ')) { await delay(1000); xml = ui(); }
}
const origin = /http:\/\/\d+\.\d+\.\d+\.\d+:\d+/u.exec(xml)?.[0];
const code = /content-desc="访问码 (\d{6})"/u.exec(xml)?.[1];
if (!origin || !code) throw new Error('手机尚未显示运行地址和访问码，请查看局域网阅读设置页');
if (process.argv.includes('--lock')) { adb('shell', 'input', 'keyevent', '223'); await delay(1500); }
if (process.argv.includes('--home')) { adb('shell', 'input', 'keyevent', '3'); await delay(1500); }
if (process.argv.includes('--doze')) {
  await doze.enter(process.argv.includes('--doze-ignore-upcoming-alarm'));
  forcedDoze = true;
}
const delayOption = process.argv.find((value) => value.startsWith('--delay-ms='));
if (delayOption) {
  const wait = Number(delayOption.split('=')[1]);
  assert.ok(Number.isInteger(wait) && wait >= 0 && wait <= 60000);
  await delay(wait);
}
if (process.argv.includes('--lock')) {
  const wakefulness = /mWakefulness=(\w+)/u.exec(adb('shell', 'dumpsys', 'power'))?.[1];
  assert.ok(['Asleep', 'Dozing'].includes(wakefulness),
    `锁屏验收需要手机保持熄屏，当前为 ${wakefulness}；此轮不能计为锁屏通过`);
}
if (process.argv.includes('--doze')) assert.equal(adb('shell', 'cmd', 'deviceidle', 'get', 'deep').trim(), 'IDLE');

const request = async (path, options = {}) => {
  try { return await fetch(origin + path, { signal: AbortSignal.timeout(10000), ...options }); }
  catch (error) { throw new Error(`手机 HTTP 请求失败：${path.split('?')[0]} (${error.name})`); }
};
const started = performance.now();
assert.equal((await request('/')).status, 200);
const checkedHttpBoundaries = process.argv.includes('--http-boundaries') ? await checkNativeHttpBoundaries(origin) : 0;
assert.equal((await request('/api/v1/books')).status, 401);
assert.equal((await request('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://untrusted.invalid' }, body: JSON.stringify({ code }) })).status, 403);
const login = await request('/api/v1/session', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ code }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\//u);
const session = await login.json();
assert.equal(session.protocolVersion, 1);
const connected = [];
try {
  for (let index = 0; index < 3; index++) {
    const pageId = randomBytes(16).toString('hex');
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 8000);
    try {
      const response = await request(`/api/v1/events?pageId=${pageId}`, { headers: { Cookie: cookie }, signal: abort.signal });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      const connection = { pageId, abort, reader, lastHeartbeat: performance.now(), error: null, feed: null };
      connected.push(connection);
      let ready = false;
      const parser = createParser({ onEvent(event) {
        if (event.event === 'ready') { const data = JSON.parse(event.data); assert.equal(data.serviceId, session.serviceId); ready = true; }
        if (event.event === 'heartbeat') {
          const data = JSON.parse(event.data);
          assert.equal(data.serviceId, session.serviceId);
          assert.equal(data.sourceReady, true, '后台数据源必须持续就绪');
          connection.lastHeartbeat = performance.now();
        }
      } });
      const decoder = new TextDecoder();
      connection.feed = (value) => parser.feed(decoder.decode(value, { stream: true }));
      while (!ready) {
        const part = await reader.read();
        assert.equal(part.done, false);
        connection.feed(part.value);
      }
    } catch (error) { abort.abort(); throw error; }
    finally { clearTimeout(timeout); }
  }
  const fourth = await request(`/api/v1/events?pageId=${randomBytes(16).toString('hex')}`, { headers: { Cookie: cookie } });
  assert.equal(fourth.status, 429);
  assert.equal((await fourth.json()).error.code, 'TOO_MANY_CLIENTS');
  const headers = { Cookie: cookie, 'X-Reader-Page-Id': connected[0].pageId };
  const queryStart = performance.now();
  const result = await request('/api/v1/books', { headers });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.serviceId, session.serviceId);
  assert.ok(Array.isArray(body.data.items));
  const allowed = ['authors', 'id', 'progress', 'status', 'title', 'updatedAt'];
  for (const book of body.data.items) assert.deepEqual(Object.keys(book).sort(), allowed);
  assert.equal((await request('/api/v1/books?action=delete', { headers })).status, 400);
  assert.equal((await request('/api/v1/books', { method: 'DELETE', headers: { ...headers, Origin: origin } })).status, 405);
  assert.equal((await request('/api/v1/books', { headers: { Cookie: cookie, 'X-Reader-Page-Id': 'unconnected-page' } })).status, 409);
  if (soakMinutes) {
    // The initial requests above ran in forced IDLE when requested. Long duration
    // measurement then uses the device's normal power policy and physical battery.
    if (forcedDoze) {
      console.log(JSON.stringify({ result: 'passed', mode: 'forced-doze', checkedPages: 3, queryAndGuardsMs: Math.round(performance.now() - queryStart) }));
      doze.dispose();
      forcedDoze = false;
    }
    const pumps = connected.map(async (connection) => {
      try {
        while (!connection.abort.signal.aborted) {
          const part = await connection.reader.read();
          if (part.done) throw new Error('持续测试中 SSE 被关闭');
          connection.feed(part.value);
        }
      } catch (error) { if (!connection.abort.signal.aborted) connection.error = error; }
    });
    const soakStarted = performance.now();
    let nextRead = soakStarted;
    let reads = 0;
    let completed = false;
    try {
      while (performance.now() - soakStarted < soakMinutes * 60_000) {
        for (const connection of connected) {
          if (connection.error) throw connection.error;
          assert.ok(performance.now() - connection.lastHeartbeat < 15000, 'SSE 心跳不能超过 15 秒');
        }
        if (performance.now() >= nextRead) {
          batteryLevel();
          const state = /mWakefulness=(\w+)/u.exec(adb('shell', 'dumpsys', 'power'))?.[1];
          assert.ok(['Asleep', 'Dozing'].includes(state), '持续测试期间需要保持熄屏');
          for (const connection of connected) {
            const response = await request('/api/v1/books', { headers: { Cookie: cookie, 'X-Reader-Page-Id': connection.pageId } });
            assert.equal(response.status, 200);
            assert.equal((await response.json()).serviceId, session.serviceId);
            reads++;
          }
          console.log(JSON.stringify({ mode: 'soak-progress', minutes: Math.round((performance.now() - soakStarted) / 6000) / 10, reads, checkedPages: 3 }));
          nextRead = performance.now() + 30_000;
        }
        await delay(1000);
      }
      const remainingBatteryLevel = batteryLevel();
      console.log(JSON.stringify({ result: 'passed', mode: 'soak', minutes: soakMinutes, reads, checkedPages: 3, physicalBatteryRequired: requireUnplugged,
        initialBatteryLevel, remainingBatteryLevel }));
      completed = true;
    } finally {
      for (const connection of connected) connection.abort.abort();
      await Promise.all(pumps);
    }
    assert.ok(completed);
  }
  assert.equal((await request('/api/v1/session', { method: 'DELETE', headers: { Cookie: cookie, Origin: origin } })).status, 204);
  assert.equal((await request('/api/v1/books', { headers })).status, 401);
  console.log(JSON.stringify({ result: 'passed', mode: process.argv.includes('--lock') ? 'locked' : process.argv.includes('--home') ? 'background' : 'foreground',
    forcedDoze, bookCount: body.data.items.length, queryAndGuardsMs: Math.round(performance.now() - queryStart), totalMs: Math.round(performance.now() - started), checkedPages: 3, checkedHttpBoundaries }));
} finally {
  for (const connection of connected) { connection.abort.abort(); await connection.reader.cancel().catch(() => undefined); }
}

if (process.argv.includes('--stop')) {
  adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', 'xvi-reader://settings/lan', 'app.xvi.reader');
  const stopStart = activate(ui(), '停止局域网阅读');
  const address = new URL(origin);
  const portIsClosed = () => new Promise((resolve) => {
    const socket = createConnection({ host: address.hostname, port: Number(address.port) });
    const finish = (refused) => { socket.destroy(); resolve(refused); };
    socket.setTimeout(200, () => finish(false));
    socket.once('connect', () => finish(false));
    socket.once('error', (error) => finish(error.code === 'ECONNREFUSED'));
  });
  let closed = false;
  while (performance.now() - stopStart < 2000) {
    if (await portIsClosed()) { closed = true; break; }
    await delay(25);
  }
  assert.ok(closed, '确认停止后 2 秒内必须关闭端口');
  const portClosedMs = Math.round(performance.now() - stopStart);
  assert.ok(!adb('shell', 'dumpsys', 'activity', 'services', 'app.xvi.reader').includes('app.xvi.reader.lan.ReaderLanService'));
  assert.ok(!/^\s*PARTIAL_WAKE_LOCK.*app\.xvi\.reader:ReaderLan/mu.test(adb('shell', 'dumpsys', 'power')));
  console.log(JSON.stringify({ result: 'passed', mode: 'stop', portClosedMs, serviceRemoved: true, wakeLockReleased: true }));
}
