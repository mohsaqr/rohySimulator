// LessonsThemeContext — tells the vendored lessons components which theme the
// surface they're mounted on uses. Default is LIGHT (the teacher/admin hub);
// the student room shell (LessonsRoomContainer) provides the dark value so
// isDark-branching components (McqNodeView, survey renderers, FileCard, …)
// pick their dark inline colors inside the `.lessons-dark` scope.
import { createContext } from 'react';

const noop = () => {};

export const LIGHT_THEME = Object.freeze({
  theme: 'light',
  isDark: false,
  setTheme: noop,
  toggleTheme: noop,
});

export const DARK_THEME = Object.freeze({
  theme: 'dark',
  isDark: true,
  setTheme: noop,
  toggleTheme: noop,
});

export const LessonsThemeContext = createContext(LIGHT_THEME);
