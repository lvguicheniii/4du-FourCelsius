import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable } from '@/components/pressable';
import { ScreenHeader } from '@/components/screen-header';
import { useCommunityConfig } from '@/contexts/community-config';
import { useAuth } from '@/contexts/auth';
import { useTheme } from '@/lib/theme';
import { groupBoardsByCategory } from '@/data/board-categories';
import { BoardIcon } from '@/components/board-icon';

export default function SelectBoardScreen() {
  const { boards } = useCommunityConfig();
  const router = useRouter();
  const { selected } = useLocalSearchParams<{ selected?: string }>();
  const { user } = useAuth();
  const { isDark, colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const availableBoards = boards.filter(board =>
    isAdmin
      ? board.id === 'announce'
      : board.id !== 'announce' && board.id !== 'free' && board.active !== 0 && board.active !== false,
  );
  const boardCategories = groupBoardsByCategory(availableBoards);
  const boardColumns = Math.max(4, Math.min(5, Math.floor((screenWidth - 28) / 84)));
  const boardTileWidth = (screenWidth - 28) / boardColumns;

  const chooseBoard = (boardId: string) => {
    router.dismissTo({
      pathname: '/publish',
      params: {
        selectedBoard: boardId,
        boardSelection: Date.now().toString(),
      },
    });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ScreenHeader title="选择冰格" floating />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          选择一个冰格，让切片被更容易发现
        </Text>
        {boardCategories.map(category => category.boards.length > 0 && (
          <View key={category.name} style={styles.category}>
            <Text style={[styles.categoryTitle, { color: colors.text }]}>{category.name}</Text>
            <View style={[styles.grid, { width: screenWidth - 28 }]}>
              {category.boards.map(board => {
                const active = selected === board.id;
                const boardColor = isDark ? board.colorDark : board.color;
                return (
                  <Pressable
                    key={board.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.board, { width: boardTileWidth }]}
                    onPress={() => chooseBoard(active ? '' : board.id)}
                  >
                    <View style={[
                      styles.iconBox,
                      isDark
                        ? {
                            backgroundColor: board.color + '28',
                            borderWidth: active ? 2 : 1,
                            borderColor: active ? boardColor : boardColor + '55',
                          }
                        : { backgroundColor: boardColor },
                      active && !isDark && styles.iconBoxActive,
                    ]}>
                      <BoardIcon name={board.icon} size={23} color={isDark ? boardColor : '#FFFFFF'} />
                      {active && (
                        <View style={[styles.check, isDark && { backgroundColor: colors.card }]}>
                          <Ionicons name="checkmark" size={10} color={boardColor} />
                        </View>
                      )}
                    </View>
                    <Text style={[styles.boardName, { color: active ? boardColor : colors.text }]} numberOfLines={1}>
                      {board.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 36 },
  hint: { fontSize: 13, lineHeight: 20, marginBottom: 14 },
  category: { marginBottom: 16 },
  categoryTitle: { marginLeft: 4, marginBottom: 11, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  board: {
    alignItems: 'center',
    marginBottom: 18,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxActive: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#33A9DC',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 4,
  },
  boardName: {
    width: '100%',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
  },
  check: {
    position: 'absolute',
    right: -4,
    top: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
});
