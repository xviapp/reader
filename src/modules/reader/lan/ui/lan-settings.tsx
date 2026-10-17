import * as Clipboard from 'expo-clipboard';
import { Copy, Power, Wifi } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/core/design/theme';
import { AppButton, AppScreen, ListRow, SubpageHeader } from '@/core/ui/host-components';
import type { LanStopReason } from '../contracts';
import { useReaderLan } from '../composition';
import { nativeLanServer, type LanConditions } from '../adapters/native-server';

const REASONS: Record<LanStopReason, string> = {
  manual: '已停止', notification: '已从通知停止', 'network-changed': 'Wi-Fi 或地址发生变化，请检查后重新开启',
  'database-unavailable': '本地数据暂不可用，服务已停止', restore: '为恢复备份，服务已停止',
  'context-lost': '后台任务已结束', 'health-timeout': '后台数据服务未响应，已停止', 'start-failed': '启动失败',
};

export function LanSettingsScreen() {
  const { controller, snapshot } = useReaderLan();
  const { palette } = useAppTheme();
  const [conditions, setConditions] = useState<LanConditions | null>(null);
  const [notice, setNotice] = useState('');
  const [permissionPending, setPermissionPending] = useState(false);
  const stopped = snapshot.phase === 'stopped';
  const busy = permissionPending || snapshot.phase === 'starting' || snapshot.phase === 'stopping';
  useEffect(() => {
    let active = true;
    const refresh = () => { void nativeLanServer().conditions().then((value) => { if (active) setConditions(value); }).catch(() => undefined); };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { active = false; subscription.remove(); };
  }, []);

  const start = async () => {
    if (busy) return;
    setPermissionPending(true); setNotice('');
    try {
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      setConditions(await nativeLanServer().conditions());
      await controller.start();
    } catch { setNotice('无法开启，请检查系统权限与后台运行设置后重试'); }
    finally { setPermissionPending(false); }
  };
  return <AppScreen>
    <SubpageHeader title="局域网阅读" />
    <ListRow icon={Wifi} title={snapshot.phase === 'running' ? '已开启' : busy ? '正在处理' : '未开启'}
      detail="电脑连接同一 Wi-Fi，在浏览器输入下方地址。网页仅供阅读。" />
    {snapshot.service ? <View style={[styles.card, { backgroundColor: palette.surfaceSoft }]}>
      <Text selectable style={{ color: palette.text, fontSize: 18 }}>{snapshot.service.address}</Text>
      <AppButton icon={Copy} label="复制地址" onPress={() => {
        void Clipboard.setStringAsync(snapshot.service!.address).then(() => setNotice('地址已复制')).catch(() => setNotice('复制失败，可长按地址选择复制'));
      }} />
      <Text style={{ color: palette.textMuted }}>本次访问码</Text>
      <Text selectable accessibilityLabel={`访问码 ${snapshot.service.code}`} style={[styles.code, { color: palette.primary }]}>{snapshot.service.code}</Text>
      <Text style={{ color: palette.textMuted }}>已连接 {snapshot.connectedPages} / 3 个页面</Text>
    </View> : null}
    <AppButton icon={Power} disabled={busy}
      label={snapshot.phase === 'starting' ? '正在开启' : snapshot.phase === 'stopping' ? '正在停止' : stopped ? '开启局域网阅读' : '停止局域网阅读'}
      onPress={() => { if (stopped) void start(); else void controller.stop(); }} />
    {snapshot.error ? <Text accessibilityRole="alert" style={{ color: palette.danger }}>{snapshot.error}</Text> : null}
    {stopped && snapshot.lastStopReason ? <Text style={{ color: palette.textMuted }}>{REASONS[snapshot.lastStopReason]}</Text> : null}
    {notice ? <Text style={{ color: palette.textMuted }}>{notice}</Text> : null}
    {conditions && !conditions.notificationsAllowed ? <Text style={{ color: palette.warning }}>通知受到限制，通知栏可能不显示停止按钮；可回到此页停止服务。</Text> : null}
    {conditions && (!conditions.batteryUnrestricted || conditions.backgroundRestricted) ? <ListRow title="检查后台运行设置"
      detail="系统可能限制锁屏后的网络和后台运行。请查看阅读应用的电池优化设置。"
      onPress={() => { void nativeLanServer().openBatterySettings().catch(() => setNotice('请在系统设置中查看阅读应用的电池优化')); }} /> : null}
    <Text style={{ color: palette.textSubtle, lineHeight: 22 }}>连接失败时，请核对手机当前地址、访客 Wi-Fi 的设备隔离和电脑防火墙。停止或切换 Wi-Fi 后，需要重新开启并验证新的访问码。</Text>
  </AppScreen>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 20, gap: 14 },
  code: { fontSize: 36, letterSpacing: 8, fontVariant: ['tabular-nums'] },
});
