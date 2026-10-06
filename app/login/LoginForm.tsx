"use client";
import { useActionState } from "react";
import { signIn } from "./actions";
import { t } from "@/lib/copy";

export function LoginForm({ next }: { next?: string }) {
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
