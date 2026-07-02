import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EditableSettings } from './settingsStore';

/*
 * Settings-profile catalog. Profiles are named EditableSettings snapshots
 * persisted to localStorage so a researcher can switch between conditions
 * without manually re-dialing sliders. The store is intentionally tiny —
 * the UI lives in `components/settings/ProfilesSection.tsx`.
 */

export interface Profile {
  name: string;
  savedAt: number;
  settings: EditableSettings;
}

interface ProfilesState {
  profiles: Profile[];
  save: (name: string, settings: EditableSettings) => void;
  remove: (name: string) => void;
  clear: () => void;
}

export const useProfiles = create<ProfilesState>()(
  persist(
    (set, get) => ({
      profiles: [],
      save: (name, settings) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const others = get().profiles.filter((p) => p.name !== trimmed);
        set({
          profiles: [
            ...others,
            { name: trimmed, savedAt: Date.now(), settings: { ...settings } },
          ].sort((a, b) => b.savedAt - a.savedAt),
        });
      },
      remove: (name) =>
        set({ profiles: get().profiles.filter((p) => p.name !== name) }),
      clear: () => set({ profiles: [] }),
    }),
    { name: 'oyon-app-settings-profiles' },
  ),
);
