import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useTheme } from '@/lib/theme';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'accent' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
  iconContent?: ReactNode;
  loading?: boolean;
  hideCancel?: boolean;
  messageAlign?: 'left' | 'center';
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({
  visible,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  tone = 'danger',
  icon,
  iconContent,
  loading = false,
  hideCancel = false,
  messageAlign = 'center',
  onCancel,
  onConfirm,
}: Props) {
  const { colors, isDark } = useTheme();
  const actionColor = tone === 'danger' ? colors.danger : colors.accent;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={[styles.overlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.68)' : 'rgba(18,20,26,0.42)' }]}>
        <View style={[styles.box, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={[styles.handle, { backgroundColor: colors.divider }]} />
          {(!!icon || !!iconContent) && (
            <View style={[styles.iconWrap, { backgroundColor: `${actionColor}18` }]}>
              {iconContent || <Ionicons name={icon!} size={25} color={actionColor} />}
            </View>
          )}
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.message, { color: colors.textMuted, textAlign: messageAlign }]}>{message}</Text>
          <View style={styles.btnRow}>
            {!hideCancel && (
              <Pressable
                accessibilityRole="button"
                style={[styles.btn, { backgroundColor: colors.input, borderColor: colors.cardBorder }]}
                disabled={loading}
                onPress={onCancel}
              >
                <Text style={[styles.cancelText, { color: colors.textSecondary }]}>{cancelText}</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              style={[styles.btn, styles.confirmBtn, { backgroundColor: `${actionColor}1F`, borderColor: `${actionColor}58` }]}
              disabled={loading}
              onPress={onConfirm}
            >
              {loading ? (
                <ActivityIndicator size="small" color={actionColor} />
              ) : (
                <Text style={[styles.confirmText, { color: actionColor }]}>{confirmText}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  box: {
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    width: '100%',
    maxWidth: 326,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 12,
  },
  handle: { width: 34, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 13,
  },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  message: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
  },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 22 },
  btn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600' },
  confirmBtn: {},
  confirmText: { fontSize: 15, fontWeight: '700' },
});
