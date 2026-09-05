import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { useTheme } from '@/lib/theme';

export type AppAlertButton = {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

type AppAlertOptions = { cancelable?: boolean; onDismiss?: () => void };
type AppAlertRequest = {
  id: number;
  title: string;
  message: string;
  buttons: AppAlertButton[];
  options?: AppAlertOptions;
};

const listeners = new Set<(request: AppAlertRequest) => void>();
let nextId = 1;

export function showAppAlert(
  title = '',
  message = '',
  buttons?: AppAlertButton[],
  options?: AppAlertOptions,
) {
  const request: AppAlertRequest = {
    id: nextId++,
    title,
    message,
    buttons: buttons?.length ? buttons : [{ text: '知道了' }],
    options,
  };
  listeners.forEach(listener => listener(request));
}

// Drop-in API for replacing React Native's platform Alert without changing call sites.
export const Alert = { alert: showAppAlert };

export function AppAlertHost() {
  const { colors, isDark } = useTheme();
  const [queue, setQueue] = useState<AppAlertRequest[]>([]);
  const active = queue[0];

  useEffect(() => {
    const listener = (request: AppAlertRequest) => setQueue(current => [...current, request]);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const dismiss = (button?: AppAlertButton) => {
    setQueue(current => current.slice(1));
    button?.onPress?.();
    active?.options?.onDismiss?.();
  };

  const cancel = () => {
    if (!active?.options?.cancelable) return;
    const cancelButton = active.buttons.find(button => button.style === 'cancel');
    dismiss(cancelButton);
  };

  return (
    <Modal
      visible={!!active}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={cancel}
    >
      <View style={[styles.overlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.68)' : 'rgba(18,20,26,0.42)' }]}>
        <View style={[styles.box, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={[styles.icon, { backgroundColor: `${colors.accent}18` }]}>
            <Ionicons name="information-circle-outline" size={26} color={colors.accent} />
          </View>
          {!!active?.title && <Text style={[styles.title, { color: colors.text }]}>{active.title}</Text>}
          {!!active?.message && <Text style={[styles.message, { color: colors.textMuted }]}>{active.message}</Text>}
          <View style={styles.actions}>
            {active?.buttons.map((button, index) => {
              const destructive = button.style === 'destructive';
              const actionColor = destructive ? colors.danger : colors.accent;
              return (
                <Pressable
                  key={`${active.id}-${index}`}
                  accessibilityRole="button"
                  style={[
                    styles.button,
                    button.style === 'cancel'
                      ? { backgroundColor: colors.input, borderColor: colors.cardBorder }
                      : { backgroundColor: `${actionColor}1F`, borderColor: `${actionColor}58` },
                  ]}
                  onPress={() => dismiss(button)}
                >
                  <Text style={[styles.buttonText, { color: button.style === 'cancel' ? colors.textSecondary : actionColor }]}>
                    {button.text || '确定'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 34 },
  box: {
    width: '100%', maxWidth: 326, borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18,
    shadowColor: '#000000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16, shadowRadius: 24, elevation: 12,
  },
  icon: { width: 46, height: 46, borderRadius: 8, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 12, fontSize: 17, lineHeight: 23, fontWeight: '700', textAlign: 'center' },
  message: { marginTop: 8, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  button: { flex: 1, minHeight: 44, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  buttonText: { fontSize: 15, fontWeight: '700' },
});
