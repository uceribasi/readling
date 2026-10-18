/** CEFR levels, used for AI stories and rewrites and for the rough level estimate. */
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
export type Level = (typeof LEVELS)[number]
