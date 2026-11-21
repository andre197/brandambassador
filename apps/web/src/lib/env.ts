/** Server-side configuration. The web app never talks to the database directly. */
export const INTERNAL_API_URL = (process.env.INTERNAL_API_URL ?? 'http://localhost:4300').replace(/\/+$/, '');
