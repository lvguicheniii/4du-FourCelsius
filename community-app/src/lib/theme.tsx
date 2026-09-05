import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const THEME_PREFERENCE_KEY = 'theme_preference';

export type ThemeColors = {
  bg: string;
  card: string;
  cardBorder: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentBg: string;
  divider: string;
  input: string;
  tabBar: string;
  tabBarBorder: string;
  header: string;
  danger: string;
  statBg: string;
};

const light: ThemeColors = {
  bg: '#F5F6FA',
  card: '#FFFFFF',
  cardBorder: '#EDEEF3',
  text: '#1A1D26',
  textSecondary: '#2A2E3B',
  textMuted: '#6B7185',
  accent: '#33A9DC',
  accentBg: '#E6F5FB',
  divider: '#F2F3F7',
  input: '#F5F6FA',
  tabBar: '#FFFFFF',
  tabBarBorder: '#EDEEF3',
  header: '#FFFFFF',
  danger: '#E24B4A',
  statBg: '#FFFFFF',
};

const dark: ThemeColors = {
  bg: '#12141A',
  card: '#1E2028',
  cardBorder: '#2A2D35',
  text: '#E8E9ED',
  textSecondary: '#D0D2D8',
  textMuted: '#8B8E99',
  accent: '#7FD8F5',
  accentBg: '#0F3242',
  divider: '#2A2D35',
  input: '#2A2D35',
  tabBar: '#1A1C24',
  tabBarBorder: '#2A2D35',
  header: '#1A1C24',
  danger: '#FF5C5C',
  statBg: '#1E2028',
};

type ThemeContextType = {
  colors: ThemeColors;
  isDark: boolean;
  followsSystem: boolean;
  toggleTheme: () => void;
  setDarkMode: (dark: boolean) => void;
  setFollowSystem: (follow: boolean) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  colors: light,
  isDark: false,
  followsSystem: true,
  toggleTheme: () => {},
  setDarkMode: () => {},
  setFollowSystem: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [forcedDark, setForcedDark] = useState<boolean | null>(null);
  const isDark = forcedDark !== null ? forcedDark : systemScheme === 'dark';

  useEffect(() => {
    SecureStore.getItemAsync(THEME_PREFERENCE_KEY)
      .then((value) => {
        if (value === 'dark') setForcedDark(true);
        else if (value === 'light') setForcedDark(false);
      })
      .catch(() => {});
  }, []);

  const setDarkMode = useCallback((darkMode: boolean) => {
    setForcedDark(darkMode);
    void SecureStore.setItemAsync(THEME_PREFERENCE_KEY, darkMode ? 'dark' : 'light').catch(() => {});
  }, []);

  const setFollowSystem = useCallback((follow: boolean) => {
    if (follow) {
      setForcedDark(null);
      void SecureStore.setItemAsync(THEME_PREFERENCE_KEY, 'system').catch(() => {});
      return;
    }
    const currentDark = systemScheme === 'dark';
    setForcedDark(currentDark);
    void SecureStore.setItemAsync(THEME_PREFERENCE_KEY, currentDark ? 'dark' : 'light').catch(() => {});
  }, [systemScheme]);

  const toggleTheme = useCallback(() => {
    setDarkMode(!isDark);
  }, [isDark, setDarkMode]);

  return (
    <ThemeContext.Provider value={{ colors: isDark ? dark : light, isDark, followsSystem: forcedDark === null, toggleTheme, setDarkMode, setFollowSystem }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
