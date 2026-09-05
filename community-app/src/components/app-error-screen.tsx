import type { ErrorBoundaryProps } from 'expo-router';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { createIncidentId, reportClientError } from '@/lib/client-error-report';

export function AppErrorScreen({ error, retry }: ErrorBoundaryProps) {
  const isDark = useColorScheme() === 'dark';
  const incidentId = useMemo(() => createIncidentId(), [error]);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    reportClientError(error, incidentId).catch(() => {});
  }, [error, incidentId]);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await retry();
    } finally {
      setRetrying(false);
    }
  };

  const returnHome = () => {
    retry().catch(() => {}).finally(() => router.replace('/'));
  };

  return (
    <View style={[styles.page, isDark && styles.pageDark]}>
      <View style={[styles.card, isDark && styles.cardDark]}>
        <View style={styles.mark}><Text style={styles.markText}>!</Text></View>
        <Text style={[styles.title, isDark && styles.textDark]}>这片海域暂时失去信号</Text>
        <Text style={[styles.message, isDark && styles.subtextDark]}>
          问题已经被记录。你可以重新加载当前页面，未发送的内容请确认后再提交。
        </Text>
        <Text selectable style={[styles.incident, isDark && styles.subtextDark]}>故障编号：{incidentId}</Text>
        <Pressable
          accessibilityRole="button"
          disabled={retrying}
          onPress={handleRetry}
          style={({ pressed }) => [styles.primaryButton, (pressed || retrying) && styles.buttonPressed]}
        >
          <Text style={styles.primaryText}>{retrying ? '正在重新加载…' : '重新加载'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={returnHome} style={styles.secondaryButton}>
          <Text style={[styles.secondaryText, isDark && styles.secondaryTextDark]}>返回浮霜带</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#F5F6FA' },
  pageDark: { backgroundColor: '#12141A' },
  card: { width: '100%', maxWidth: 420, alignItems: 'center', borderRadius: 24, paddingHorizontal: 24, paddingVertical: 32, backgroundColor: '#FFFFFF' },
  cardDark: { backgroundColor: '#1A1C24' },
  mark: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: '#E7F6FC', marginBottom: 18 },
  markText: { color: '#269AC9', fontSize: 28, fontWeight: '700' },
  title: { color: '#1A1D26', fontSize: 19, fontWeight: '700', textAlign: 'center' },
  textDark: { color: '#E8E9ED' },
  message: { marginTop: 12, color: '#6C7480', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  subtextDark: { color: '#AEB5C0' },
  incident: { marginTop: 14, color: '#87909B', fontSize: 12 },
  primaryButton: { width: '100%', minHeight: 46, marginTop: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: '#33A9DC' },
  buttonPressed: { opacity: 0.72 },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  secondaryButton: { minHeight: 42, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#66717C', fontSize: 14, fontWeight: '600' },
  secondaryTextDark: { color: '#AFC3CE' },
});
