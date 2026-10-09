"use client";
import { useActionState } from "react";
import Link from "next/link";
import { signIn, sendMagicLink } from "./actions";
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

/** Sign-in by a one-time link sent to the email address. */
export function MagicLinkForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(sendMagicLink, undefined);
  if (state?.sent)
    return (
      <div role="status" className="flex flex-col gap-3 rounded-md bg-surface p-4 text-sm">
        <p>{t.login.sent(state.sent)}</p>
        {state.devLink && (
          <p>
            {t.login.devLink}{" "}
            <a href={state.devLink} className="break-all font-semibold text-accent underline underline-offset-2">{t.login.devLinkOpen}</a>
          </p>
        )}
      </div>
    );
  const error = state?.error;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.login.email}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={state?.email}
          aria-invalid={error === "email"}
          aria-describedby={error === "email" ? "link-error" : "link-lead"}
          className="h-10 rounded-md border border-border-input bg-bg px-3"
        />
        <span id="link-lead" className="text-xs text-text-muted">
          {t.login.linkLead}
        </span>
      </label>
      {/* Consent to personal data processing is a checkbox of its own (152-FZ art. 9), checked on the server. */}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="consent"
          value="yes"
          defaultChecked={state?.consent}
          aria-invalid={error === "consent"}
          aria-describedby={error === "consent" ? "link-error" : undefined}
          className="mt-0.5 size-4 shrink-0 accent-accent"
        />
        <span>
          {t.login.consentBefore}{" "}
          <Link href="/consent" target="_blank" className="text-accent underline underline-offset-2">{t.login.consentLink}</Link>
        </span>
      </label>
      {error && (
        <p id="link-error" role="alert" className="text-sm text-danger">
          {t.login.errors[error]}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-md bg-accent font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
      >
        {t.login.sendLink}
      </button>
      <p className="text-xs text-text-muted">
        {t.login.termsBefore}{" "}
        <Link href="/terms" target="_blank" className="underline underline-offset-2">{t.login.termsLink}</Link>{" "}
        {t.login.termsAnd}{" "}
        <Link href="/privacy" target="_blank" className="underline underline-offset-2">{t.login.privacyLink}</Link>.
      </p>
    </form>
  );
}
