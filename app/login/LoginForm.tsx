"use client";
import { useActionState } from "react";
import { signIn, sendMagicLink, signInWithGoogle } from "./actions";
import { t } from "@/lib/copy";

/** Development sign-in: name and email, no password. */
export function DevLoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.login.name}</span>
        <input name="name" autoComplete="name" className="h-10 rounded-md border border-border-input bg-bg px-3" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.login.email}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          aria-invalid={state?.error === "email"}
          aria-describedby={state?.error ? "email-error" : undefined}
          className="h-10 rounded-md border border-border-input bg-bg px-3"
        />
        {state?.error === "email" && (
          <span id="email-error" role="alert" className="text-sm text-danger">
            {t.login.errorEmail}
          </span>
        )}
      </label>
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-md bg-accent font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
      >
        {t.login.submit}
      </button>
      <p className="text-xs text-text-muted">{t.login.devNote}</p>
    </form>
  );
}

/** Supabase sign-in: a one-time link by email, or Google. */
export function MagicLinkForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(sendMagicLink, undefined);
  if (state?.sent)
    return (
      <p role="status" className="rounded-md bg-surface p-4 text-sm">
        {t.login.sent(state.sent)}
      </p>
    );
  return (
    <div className="flex flex-col gap-4">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next ?? ""} />
        <button type="submit" className="h-10 w-full rounded-md border border-border-input bg-bg font-semibold hover:bg-surface">
          {t.login.google}
        </button>
      </form>
      <p className="text-center text-xs text-text-muted">{t.login.or}</p>
      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="next" value={next ?? ""} />
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t.login.email}</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            aria-invalid={state?.error === "email"}
            aria-describedby={state?.error ? "link-error" : "link-lead"}
            className="h-10 rounded-md border border-border-input bg-bg px-3"
          />
          <span id="link-lead" className="text-xs text-text-muted">
            {t.login.linkLead}
          </span>
          {state?.error && (
            <span id="link-error" role="alert" className="text-sm text-danger">
              {state.error === "email" ? t.login.errorEmail : t.login.errorSend}
            </span>
          )}
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-md bg-accent font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {t.login.sendLink}
        </button>
      </form>
    </div>
  );
}
