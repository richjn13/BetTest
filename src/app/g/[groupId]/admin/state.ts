/**
 * Form state for the admin panel.
 *
 * This lives outside actions.ts because that file is marked "use server", and
 * such a file may only export async functions. Exporting a plain object from
 * it throws at module load in production -- taking the whole page down before
 * any request handler runs.
 */
export type AdminState = { error: string | null; message: string | null };

export const IDLE: AdminState = { error: null, message: null };
