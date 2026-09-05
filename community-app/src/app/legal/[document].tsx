import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '@/components/screen-header';
import { LEGAL_DOCUMENTS, LEGAL_OPERATOR } from '@/data/legal-documents';
import { useTheme } from '@/lib/theme';

export default function LegalDocumentScreen() {
  const { document } = useLocalSearchParams<{ document: string }>();
  const { colors } = useTheme();
  const content = LEGAL_DOCUMENTS[document || ''] || LEGAL_DOCUMENTS['privacy-policy'];

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={content.title} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={[styles.updated, { color: colors.textMuted }]}>更新日期：{content.updatedAt}</Text>
        <Text style={[styles.intro, { color: colors.text }]}>{content.intro}</Text>
        {content.sections.map(section => (
          <View key={section.heading} style={styles.section}>
            <Text style={[styles.heading, { color: colors.text }]}>{section.heading}</Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>{section.body}</Text>
          </View>
        ))}
        <Text style={[styles.footer, { color: colors.textMuted }]}>{LEGAL_OPERATOR}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 42 },
  updated: { fontSize: 11, lineHeight: 18 },
  intro: { fontSize: 14, lineHeight: 23, marginTop: 14 },
  section: { marginTop: 22 },
  heading: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 23, marginTop: 7 },
  footer: { fontSize: 12, textAlign: 'right', marginTop: 28 },
});
