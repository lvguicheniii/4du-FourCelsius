import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { useTheme } from '@/lib/theme';

const EMOJI_GROUPS = [
  {
    title: '常用',
    emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥳','🤩','🥺','😢','😭','😤','😡','🤬','🤯','😳','🥵','🥶','😱','😨','🤔','🫡','🤭','🫢','🫣','😶','😐','😑','🙄','😬','😴','🤤','🤢','🤮','🤧','😷','🤒','🤕','😈','👻','💀','🤡'],
  },
  {
    title: '手势',
    emojis: ['👋','🤚','🖐️','✋','🖖','🫱','🫲','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💪','🫵'],
  },
  {
    title: '人物与心情',
    emojis: ['👀','👁️','🧠','🫀','🗣️','👶','🧒','👦','👧','🧑','👩','👨','👵','👴','🙋','🙆','🙅','🤷','🤦','🙇','💁','🧘','🛌','💃','🕺','🫂','💋','💌','💘','💝','💖','💗','💓','💞','💕','💟','❣️','💔','❤️','🩷','🧡','💛','💚','💙','🩵','💜','🤎','🖤','🩶','🤍'],
  },
  {
    title: '动物与自然',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦄','🐝','🦋','🐌','🐞','🐟','🐠','🐬','🐳','🦈','🐙','🦀','🌱','🌿','☘️','🍀','🌵','🌲','🌳','🌴','🌸','🌹','🌺','🌻','🌼','🍁','🍂','🍃','🌊','❄️','☃️','🔥','✨','⭐','🌙','☀️','🌈'],
  },
  {
    title: '食物',
    emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥝','🍅','🥑','🍆','🥔','🥕','🌽','🌶️','🍄','🥐','🍞','🥨','🧀','🥚','🍳','🥞','🍔','🍟','🍕','🌭','🥪','🌮','🍜','🍝','🍣','🍙','🍚','🍱','🍦','🍰','🧁','🍭','🍬','🍫','🍿','🍩','🍪','☕','🧋','🍺','🍻','🥂'],
  },
  {
    title: '活动',
    emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏓','🏸','🥊','🎮','🕹️','🎲','🧩','🎯','🎳','🎨','🎭','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎸','🎻','🏆','🥇','🎉','🎊','🎈','🎁'],
  },
  {
    title: '旅行与物品',
    emojis: ['🚗','🚕','🚌','🚎','🏎️','🚓','🚑','🚒','🚲','✈️','🚀','🚢','⚓','⛺','🏠','🏙️','🌃','🗺️','🧭','⌚','📱','💻','⌨️','📷','📹','💡','🔦','📚','📌','📍','✂️','🔒','🔑','🔨','🧲','🧪','🧊','🧸','🛍️','📦','✉️','📣','🔔'],
  },
  {
    title: '符号',
    emojis: ['✅','❌','⭕','❗','❓','‼️','⁉️','💯','🔞','🚫','⚠️','♻️','💤','💢','💥','💫','💦','💨','🕳️','💬','🗨️','🗯️','💭','♠️','♥️','♦️','♣️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','⬆️','⬇️','⬅️','➡️','↗️','↘️','↙️','↖️','↔️','🔁','▶️','⏸️'],
  },
] as const;

export function EmojiPicker({ onSelect, maxHeight = 220 }: { onSelect: (emoji: string) => void; maxHeight?: number }) {
  const { colors } = useTheme();
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const activeGroup = EMOJI_GROUPS[activeGroupIndex];

  return (
    <View>
      <ScrollView
        horizontal
        contentContainerStyle={styles.tabs}
        keyboardDismissMode="none"
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
      >
        {EMOJI_GROUPS.map((group, index) => {
          const active = index === activeGroupIndex;
          return (
            <Pressable
              key={group.title}
              style={[styles.tab, active && { backgroundColor: colors.accentBg }]}
              onPress={() => setActiveGroupIndex(index)}
            >
              <Text style={[styles.tabText, { color: active ? colors.accent : colors.textMuted }]}>{group.title}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView
        style={[styles.scroll, { maxHeight, borderTopColor: colors.divider }]}
        contentContainerStyle={styles.content}
        keyboardDismissMode="none"
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.grid}>
          {activeGroup.emojis.map((emoji, index) => (
            <Pressable
              key={`${activeGroup.title}-${emoji}-${index}`}
              accessibilityLabel={`插入表情 ${emoji}`}
              style={styles.cell}
              onPress={() => onSelect(emoji)}
            >
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: 8, paddingVertical: 7, gap: 5 },
  tab: { minHeight: 30, justifyContent: 'center', borderRadius: 15, paddingHorizontal: 11 },
  tabText: { fontSize: 12, fontWeight: '600' },
  scroll: { borderTopWidth: StyleSheet.hairlineWidth },
  content: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '12.5%', minHeight: 43, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 25, lineHeight: 33 },
});
