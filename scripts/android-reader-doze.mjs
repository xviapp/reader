import assert from 'node:assert/strict';
import { androidCommand as adb } from './android-reader-ui.mjs';

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

/** Test-only changes are restored even if entering IDLE fails. Never simulates battery power. */
export class AndroidReaderDoze {
  #constants = null;
  #changedConstants = false;
  #started = false;

  async enter(ignoreUpcomingAlarm = false) {
    assert.equal(adb('shell', 'cmd', 'deviceidle', 'get', 'force').trim(), 'false', '其他测试已强制进入 Doze，本次不接管');
    this.#started = true;
    if (ignoreUpcomingAlarm) {
      this.#constants = adb('shell', 'settings', 'get', 'global', 'device_idle_constants').trim();
      const entries = this.#constants === 'null' ? [] : this.#constants.split(',').filter((entry) => !entry.startsWith('min_time_to_alarm='));
      this.#changedConstants = true;
      adb('shell', 'settings', 'put', 'global', 'device_idle_constants', quote([...entries, 'min_time_to_alarm=0'].join(',')));
      for (let attempt = 0; attempt < 20; attempt++) {
        if (/min_time_to_alarm=0(?:ms)?\s/u.test(adb('shell', 'dumpsys', 'deviceidle'))) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.match(adb('shell', 'dumpsys', 'deviceidle'), /min_time_to_alarm=0(?:ms)?\s/u);
    }
    adb('shell', 'cmd', 'deviceidle', 'force-idle', 'deep');
    assert.equal(adb('shell', 'cmd', 'deviceidle', 'get', 'deep').trim(), 'IDLE');
  }

  dispose() {
    try { if (this.#started) adb('shell', 'cmd', 'deviceidle', 'unforce'); }
    finally {
      this.#started = false;
      if (this.#changedConstants) {
        if (this.#constants === 'null') adb('shell', 'settings', 'delete', 'global', 'device_idle_constants');
        else adb('shell', 'settings', 'put', 'global', 'device_idle_constants', quote(this.#constants));
        this.#changedConstants = false;
      }
    }
  }
}
