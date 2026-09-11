/** Lives outside actions.ts: a "use server" file exports only async functions. */
export type ProfileState = { error: string | null; message: string | null };

export const IDLE: ProfileState = { error: null, message: null };
