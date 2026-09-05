import { useSyncExternalStore } from 'react';
import { getStoreVersion, getStructuralStoreVersion, subscribeStore } from '@/data/store';

export function useStoreVersion() {
  return useSyncExternalStore(subscribeStore, getStoreVersion, getStoreVersion);
}

export function useStructuralStoreVersion() {
  return useSyncExternalStore(subscribeStore, getStructuralStoreVersion, getStructuralStoreVersion);
}
