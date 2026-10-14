"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { signIn, signUp } from "@/src/lib/auth-client";

type Mode = "sign-in" | "sign-up";

export function SignInForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const authConfig = useQuery(api.auth_config.getPublicAuthConfig);

  // Zero-friction first boot (ADR-029): a fresh self-hosted instance has no
  // account yet, so /sign-in (the app layout's default redirect target)
  // should hand off to /sign-up instead of showing a form for an account
  // that can't exist. Only fires once the query has resolved (`!== undefined`)
  // and only away from sign-in, so it never fights the "Already have an
  // account? Sign in" link once an account does exist.
  useEffect(() => {
    if (mode === "sign-in" && authConfig?.hasExistingAccount === false) {
      router.replace("/sign-up");
    }
  }, [mode, authConfig?.hasExistingAccount, router]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result =
      mode === "sign-up"
        ? await signUp.email({ name, email, password })
        : await signIn.email({ email, password });

    setSubmitting(false);
    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Please try again.");
      return;
    }
    router.push("/");
  }

  return (
    <div className="w-full max-w-sm rounded-[var(--dashboard-radius-panel)] bg-[var(--dashboard-surface-container-lowest)] p-8 shadow-[var(--dashboard-shadow)]">
      <h1 className="text-xl font-semibold text-[var(--dashboard-ink)]">
        {mode === "sign-up" ? "Create your account" : "Sign in"}
      </h1>
      <p className="mt-1 text-sm text-[var(--dashboard-ink-muted)]">
        {mode === "sign-up"
          ? "Create the admin account for this self-hosted OpenGroow."
          : "Sign in to OpenGroow."}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        {mode === "sign-up" && (
          <input
            type="text"
            required
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-[var(--dashboard-radius-control)] border border-[var(--dashboard-outline-strong)] px-3 py-2 text-sm"
          />
        )}
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-[var(--dashboard-radius-control)] border border-[var(--dashboard-outline-strong)] px-3 py-2 text-sm"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-[var(--dashboard-radius-control)] border border-[var(--dashboard-outline-strong)] px-3 py-2 text-sm"
        />

        {error && <p className="text-sm text-[var(--dashboard-tertiary)]">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-[var(--dashboard-radius-control)] bg-[var(--dashboard-primary)] px-4 py-2 text-sm font-semibold text-[var(--dashboard-on-primary)] disabled:opacity-60"
        >
          {mode === "sign-up" ? "Create account" : "Sign in"}
        </button>
      </form>

      <Link
        href={mode === "sign-up" ? "/sign-in" : "/sign-up"}
        className="mt-4 block text-sm text-[var(--dashboard-ink-muted)] underline"
      >
        {mode === "sign-up" ? "Already have an account? Sign in" : "First time here? Create an account"}
      </Link>
    </div>
  );
}
