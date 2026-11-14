// Types for stateColours.js — one colour per state for the whole app.
export declare const OKABE_ITO: ReadonlyArray<string>;
export declare const EMOTION_STATES: ReadonlyArray<string>;
export declare const EMOTION_COLOURS: Readonly<Record<string, string>>;
export declare const LEVEL_COLOURS: Readonly<Record<string, string>>;
export declare function stateColourMap(states: ReadonlyArray<string | null | undefined>): Record<string, string>;
export declare function resetStateColours(): void;
