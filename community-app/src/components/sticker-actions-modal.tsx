import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Pressable } from '@/components/pressable';
import { useTheme } from '@/lib/theme';
import { cachedImageSource } from '@/lib/media-cache';

export type StickerActionAnchor = { x: number; y: number };

type Props = {
  visible: boolean;
  anchor: StickerActionAnchor;
  previewUri?: string | null;
  loading?: boolean;
  onClose: () => void;
  onMoveToFront: () => void;
  onDelete: () => void;
};

const POPOVER_WIDTH = 154;
const POPOVER_HEIGHT = 142;

export function StickerActionsModal({ visible, anchor, previewUri, loading = false, onClose, onMoveToFront, onDelete }: Props) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const left = Math.max(10, Math.min(anchor.x - POPOVER_WIDTH / 2, width - POPOVER_WIDTH - 10));
  const top = Math.max(12, Math.min(anchor.y - POPOVER_HEIGHT - 26, height - POPOVER_HEIGHT - 12));

  if (!visible) return null;

  return (
    <Pressable style={styles.overlay} onPress={loading ? undefined : onClose}>
      <Pressable style={[styles.card, { left, top, backgroundColor: colors.card, borderColor: colors.divider, opacity: loading ? 0.72 : 1 }]} onPress={(event) => event.stopPropagation()}>
        <View style={[styles.previewWrap, { backgroundColor: colors.input, borderColor: colors.divider }]}>
          {previewUri ? <ExpoImage source={cachedImageSource(previewUri)} style={styles.previewImage} contentFit="contain" cachePolicy="memory-disk" autoplay transition={0} /> : null}
        </View>
        <Pressable
          disabled={loading}
          style={[styles.row, { borderColor: colors.divider }]}
          onPress={onMoveToFront}
        >
          <Ionicons name="arrow-up-circle-outline" size={17} color={colors.accent} />
          <Text style={[styles.rowText, { color: colors.text }]}>移到最前</Text>
        </Pressable>
        <Pressable
          disabled={loading}
          style={[styles.row, { borderColor: colors.divider }]}
          onPress={onDelete}
        >
          <Ionicons name="trash-outline" size={17} color={colors.danger} />
          <Text style={[styles.rowText, { color: colors.danger }]}>删除</Text>
        </Pressable>
        {loading ? <ActivityIndicator style={styles.loading} size="small" color={colors.accent} /> : null}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.44)',
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    position: 'absolute',
    width: POPOVER_WIDTH,
    minHeight: POPOVER_HEIGHT,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 7,
    paddingVertical: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  previewWrap: {
    width: 62,
    height: 62,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
    overflow: 'hidden',
  },
  previewImage: { width: 56, height: 56 },
  row: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    marginLeft: 8,
    fontSize: 12,
    fontWeight: '600',
  },
  loading: {
    position: 'absolute',
    right: 7,
    top: 33,
  },
});
