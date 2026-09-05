import { Ionicons } from '@expo/vector-icons';
import { Text, TextProps } from 'react-native';
import { useCommunityConfig } from '@/contexts/community-config';
import { useTheme } from '@/lib/theme';
import { useRouter } from 'expo-router';

type Props = TextProps & {
  content: string;
};

export function PostContentText({ content, style, ...props }: Props) {
  const { colors } = useTheme();
  const { dailyTopic, dailyTopicHistory } = useCommunityConfig();
  const router = useRouter();
  const newlineIndex = content.indexOf('\n');
  const firstLine = newlineIndex >= 0 ? content.slice(0, newlineIndex) : content;
  const topic = /^#\S+$/.test(firstLine) ? firstLine : '';
  const body = topic && newlineIndex >= 0 ? content.slice(newlineIndex + 1) : '';
  const normalizedTopic = topic.replace(/^#/, '');
  const isDailyTopic = !!topic && [dailyTopic, ...dailyTopicHistory].some(
    item => item?.title.replace(/^#/, '') === normalizedTopic,
  );

  return (
    <Text style={style} {...props}>
      {topic ? (
        <>
          <Text
            accessibilityRole="link"
            style={{ color: colors.accent, fontWeight: '600' }}
            onPress={(event) => {
              event.stopPropagation?.();
              router.push({ pathname: '/topic/[name]', params: { name: topic.slice(1) } });
            }}
          >
            {isDailyTopic ? (
              <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
            ) : null}
            {isDailyTopic ? ' ' : null}
            {topic}
          </Text>
          {body ? `\n${body}` : null}
        </>
      ) : content}
    </Text>
  );
}
