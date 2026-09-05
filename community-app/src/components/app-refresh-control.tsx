import { RefreshControl } from 'react-native';

export const REFRESH_INDICATOR_GAP = 12;

export function refreshIndicatorBelow(topChromeBottom: number) {
  return Math.max(REFRESH_INDICATOR_GAP, Math.round(topChromeBottom + REFRESH_INDICATOR_GAP));
}

// refreshControl must receive the native component directly under Fabric on Android.
// Wrapping it in a function component can leave the ScrollView/FlatList content unmounted.
export const AppRefreshControl = RefreshControl;
