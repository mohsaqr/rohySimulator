// LAILA's `useTheme` hook returns `{ isDark, toggle }`. The simulator UI
// runs dark-only today, so this stub just reports `isDark: true`. If the
// project later adds a real theme switcher, replace this with the shared
// hook and the LAILA components pick up the change for free.
export function useTheme() {
    return { isDark: true };
}
