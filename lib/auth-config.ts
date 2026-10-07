// Which sign-in methods are on. Supabase Auth needs the Postgres data layer: profiles come from its auth.users trigger.
export const supabaseAuthEnabled = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) && process.env.DATA_LAYER === "postgres";

// The passwordless test sign-in: always on in development, and in production only when DEV_SIGN_IN=1 (staging).
export const devSignInEnabled = () => process.env.NODE_ENV !== "production" || process.env.DEV_SIGN_IN === "1";
