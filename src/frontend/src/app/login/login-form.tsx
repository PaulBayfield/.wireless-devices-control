"use client";

import { useActionState } from "react";

import { login, type LoginState } from "@/app/actions/auth";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block">
        <span className="text-sm font-medium">API token</span>
        <input
          name="token"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-500">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
