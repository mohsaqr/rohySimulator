// useTheme — reads the surrounding LessonsThemeContext. Teacher/admin surfaces
// get the light default; the student room shell provides the dark value. Same
// return shape as the LAILA source hook.
import { useContext } from 'react';
import { LessonsThemeContext } from './LessonsThemeContext';

export const useTheme = () => useContext(LessonsThemeContext);
