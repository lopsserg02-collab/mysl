"use client";
import { useActionState, useState, type FormEvent } from "react";
import Link from "next/link";
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
  // Consent to personal data processing is its own checkbox (152-FZ art. 9) and covers both ways in.
  const [agreed, setAgreed] = useState(false);
  const [missing, setMissing] = useState(false);
  const requireConsent = (e: FormEvent) => {
    if (agreed) return;
    e.preventDefault();
    setMissing(true);
  };
  const consentMissing = missing || state?.error === "consent";
  const consent = <input type="hidden" name="consent" value={agreed ? "yes" : ""} />;
  if (state?.sent)
    return (
      <p role="status" className="rounded-md bg-surface p-4 text-sm">
        {t.login.sent(state.sent)}
      </p>
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="consent-box"
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked);
              if (e.target.checked) setMissing(false);
            }}
            aria-invalid={consentMissing && !agreed}
            aria-describedby={consentMissing && !agreed ? "consent-error" : undefined}
            className="mt-0.5 size-4 shrink-0 accent-accent"
          />
          <span>
            {t.login.consentBefore}{" "}
            <Link href="/consent" target="_blank" className="text-accent underline underline-offset-2">{t.login.consentLink}</Link>
          </span>
        </label>
        {consentMissing && !agreed && (
          <span id="consent-error" role="alert" className="text-sm text-danger">
            {t.login.errorConsent}
          </span>
        )}
        <p className="text-xs text-text-muted">
          {t.login.termsBefore}{" "}
          <Link href="/terms" target="_blank" className="underline underline-offset-2">{t.login.termsLink}</Link>{" "}
          {t.login.termsAnd}{" "}
          <Link href="/privacy" target="_blank" className="underline underline-offset-2">{t.login.privacyLink}</Link>.
        </p>
      </div>
      <form action={signInWithGoogle} onSubmit={requireConsent}>
        <input type="hidden" name="next" value={next ?? ""} />
        {consent}
        <button type="submit" className="h-10 w-full rounded-md border border-border-input bg-bg font-semibold hover:bg-surface">
          {t.login.google}
        </button>
      </form>
      <p className="text-center text-xs text-text-muted">{t.login.or}</p>
      <form action={action} onSubmit={requireConsent} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="next" value={next ?? ""} />
        {consent}
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
          {state?.error && state.error !== "consent" && (
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
