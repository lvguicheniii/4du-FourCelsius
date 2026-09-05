import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable } from '@/components/pressable';
import { ScreenHeader } from '@/components/screen-header';
import { useTheme } from '@/lib/theme';
import { useCommunityConfig } from '@/contexts/community-config';

const FALLBACK_TOPICS = [
  '#社交断电',
  '#允许自己融化',
  '#无意义漂浮',
  '#低能量预警',
  '#一次静音的崩溃',
  '#情绪回收站',
  '#潜流打捞局',
  '#4°C避难所',
  '#寻找同频',
  '#今日水压偏高',
  '#人类观察日志',
  '#光合作用记录',
  '#深夜白噪音',
  '#毫无用处的冷知识',
  '#路灯下的影子',
  '#强制下线',
  '#精神离职',
  '#做一棵树',
];

export default function SelectTopicScreen() {
  const router = useRouter();
  const { selected } = useLocalSearchParams<{ selected?: string }>();
  const { colors } = useTheme();
  const { topics: configuredTopics, dailyTopicHistory } = useCommunityConfig();
  const [showHistory, setShowHistory] = useState(false);
  const topics = configuredTopics.length ? configuredTopics : FALLBACK_TOPICS;

  const chooseTopic = (topic: string) => {
    router.dismissTo({
      pathname: '/publish',
      params: {
        selectedTopic: selected === topic ? '' : topic,
        topicSelection: Date.now().toString(),
      },
    });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ScreenHeader floating
        title={showHistory ? '历史每日话题' : '选择话题'}
        right={
          <Pressable onPress={() => setShowHistory(current => !current)}>
            <Text style={[styles.historyLink, { color: colors.accent }]}>{showHistory ? '返回选择' : '历史每日话题'}</Text>
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {showHistory ? (
          <>
            <Text style={[styles.hint, { color: colors.textMuted }]}>过期的每日话题仍然可以选择，也可以继续发布新的切片。</Text>
            <View style={styles.historyList}>
              {dailyTopicHistory.map(item => {
                const topic = `#${item.title.replace(/^#/, '')}`;
                return (
                  <Pressable
                    key={item.id}
                    style={[styles.historyTopic, { backgroundColor: colors.card, borderColor: colors.accent + '35' }]}
                    onPress={() => chooseTopic(topic)}
                  >
                    <Text style={[styles.historyDate, { color: colors.textMuted }]}>{item.themeDate}</Text>
                    <Text style={[styles.topicText, { color: colors.accent }]}>{topic}</Text>
                  </Pressable>
                );
              })}
              {dailyTopicHistory.length === 0 && <Text style={[styles.empty, { color: colors.textMuted }]}>暂无历史每日话题</Text>}
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.hint, { color: colors.textMuted }]}>选择一个话题，它会出现在切片文字的第一行</Text>
            <View style={styles.topics}>
              {topics.map(topic => (
            <Pressable
              key={topic}
              accessibilityRole="button"
              accessibilityState={{ selected: selected === topic }}
              style={[
                styles.topic,
                {
                  backgroundColor: colors.accent + (selected === topic ? '2E' : '14'),
                  borderColor: colors.accent + (selected === topic ? 'A0' : '42'),
                },
              ]}
              onPress={() => chooseTopic(topic)}
            >
              <Text style={[styles.topicText, { color: colors.accent }]}>{topic}</Text>
            </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 36 },
  hint: { fontSize: 13, lineHeight: 20, marginBottom: 15 },
  historyLink: { fontSize: 12, fontWeight: '600' },
  historyList: { gap: 9 },
  historyTopic: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  historyDate: { fontSize: 10, marginBottom: 4 },
  empty: { textAlign: 'center', paddingTop: 60, fontSize: 13 },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  topic: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  topicText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
