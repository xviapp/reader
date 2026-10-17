import Constants from 'expo-constants';
import { Image, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, typography, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { AppScreen, ListRow, SubpageHeader } from '@/core/ui/host-components';

export default function AboutScreen() {
  const styles = useThemedStyles(createStyles);
  return (
    <AppScreen>
      <SubpageHeader title="关于阅读" />
      <View style={styles.identity}>
        <Image source={require('../../assets/brand/icon.webp')} style={styles.icon} accessibilityLabel="阅读" />
        <Text style={styles.name}>阅读</Text>
        <Text style={styles.tagline}>求知于卷，问道于天</Text>
      </View>
      <ListRow title="版本" detail={Constants.expoConfig?.version ?? '1.0.0'} />
      <View style={styles.description}>
        <Text accessibilityRole="header" style={styles.title}>本地优先</Text>
        <Text style={styles.detail}>书籍、摘录、图片和讨论保存在本机，不会自动备份或同步；可在设置中手动导出备份。卸载应用会删除未导出的数据。</Text>
      </View>
      <View style={styles.description}>
        <Text accessibilityRole="header" style={styles.title}>AI 可选</Text>
        <Text style={styles.detail}>手动阅读和摘录无需配置 AI。仅在你主动整理、分析或讨论时，内容才会发送给所选服务；分析建议由你确认后生效。</Text>
      </View>
    </AppScreen>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    identity: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
    icon: { width: 80, height: 80, borderRadius: radius.sheet },
    name: { ...typography.pageTitle, color: palette.text },
    tagline: { ...typography.body, color: palette.textMuted, textAlign: 'center' },
    description: { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing.xs, padding: spacing.sm },
    title: { ...typography.section, color: palette.text },
    detail: { ...typography.body, color: palette.textMuted },
  });
}
