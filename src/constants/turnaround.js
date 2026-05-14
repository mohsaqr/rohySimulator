// Frontend mirror of server/lib/turnaround.js. Same numeric value, kept in
// sync by convention — both files are tiny and rarely change. Imported by
// every place that used to hardcode `30` as a "default" turnaround.
//
// The sim's design intent is 1-5 wall-clock minutes for compressed pacing.
// 3 is the middle of that band and matches the backend resolver fallback.

export const DEFAULT_TURNAROUND_MINUTES = 3;
