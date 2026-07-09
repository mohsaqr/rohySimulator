import { createContext } from 'react';

/**
 * Lecture context made available to lesson node views (e.g. the video
 * player) so they can attribute activity logs to the right course/lecture.
 * Provided by LessonViewer on the student lecture page; absent in the
 * editor (where we don't track watch time).
 */
export const LessonMediaContext = createContext({});
