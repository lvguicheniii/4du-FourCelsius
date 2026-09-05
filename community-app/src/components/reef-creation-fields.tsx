import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';

type Props = {
  name: string;
  capacity: string;
  duration: string;
  onNameChange: (value: string) => void;
  onCapacityChange: (value: string) => void;
  onDurationChange: (value: string) => void;
};

export function normalizeReefNumber(value: string, min: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min
    ? Math.min(44, Math.floor(parsed))
    : fallback;
}

function NumberField({
  label,
  icon,
  value,
  min,
  fallback,
  unit,
  onChange,
}: {
  label: string;
  icon: 'people-outline' | 'hourglass-outline';
  value: string;
  min: number;
  fallback: number;
  unit: string;
  onChange: (value: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.numberBlock}>
      <View style={styles.labelRow}>
        <View style={styles.labelIdentity}>
          <Ionicons name={icon} size={15} color={colors.accent} />
          <Text style={[styles.numberLabel, { color: colors.text }]}>{label}</Text>
        </View>
      </View>
      <View style={styles.inputRow}>
        <TextInput
          value={value}
          onChangeText={text => onChange(text.replace(/\D/g, '').slice(0, 2))}
          onBlur={() => onChange(String(normalizeReefNumber(value, min, fallback)))}
          keyboardType="number-pad"
          selectTextOnFocus
          maxLength={2}
          style={[styles.numberInput, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.divider }]}
        />
        <Text style={[styles.unit, { color: colors.textSecondary }]}>{unit}</Text>
      </View>
      <Text style={[styles.limit, { color: colors.textMuted }]}>上限 44 {unit}</Text>
    </View>
  );
}

export function ReefCreationFields({
  name,
  capacity,
  duration,
  onNameChange,
  onCapacityChange,
  onDurationChange,
}: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.nameBlock}>
        <View style={styles.labelIdentity}>
          <Ionicons name="text-outline" size={15} color={colors.accent} />
          <Text style={[styles.nameLabel, { color: colors.text }]}>礁石名称</Text>
        </View>
        <TextInput
          value={name}
          onChangeText={onNameChange}
          maxLength={18}
          placeholder="2-18 个字"
          placeholderTextColor={colors.textMuted}
          style={[styles.nameInput, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.divider }]}
        />
      </View>
      <View style={styles.numberGrid}>
        <NumberField label="最大容纳人数" icon="people-outline" value={capacity} min={2} fallback={30} unit="人" onChange={onCapacityChange} />
        <NumberField label="礁石存在时间" icon="hourglass-outline" value={duration} min={1} fallback={24} unit="小时" onChange={onDurationChange} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 16 },
  nameBlock: { width: '100%', gap: 8 },
  labelIdentity: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  nameInput: { height: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 13, fontSize: 15 },
  numberGrid: { width: '100%', flexDirection: 'row', gap: 14 },
  numberBlock: { flex: 1, minWidth: 0 },
  labelRow: { minHeight: 20, flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  numberLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  limit: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  numberInput: { flex: 1, minWidth: 64, height: 46, borderWidth: 1, borderRadius: 8, textAlign: 'center', fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  unit: { width: 36, marginLeft: 8, fontSize: 13, fontWeight: '600' },
});
