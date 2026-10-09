// The passwordless test sign-in: always on in development, and in production only when DEV_SIGN_IN=1 (staging).
// Everyone else signs in with a one-time link sent to their email (app/login/actions.ts).
export const devSignInEnabled = () => process.env.NODE_ENV !== "production" || process.env.DEV_SIGN_IN === "1";
