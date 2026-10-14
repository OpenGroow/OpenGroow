import { SignInForm } from "@/src/components/sign-in-form";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--dashboard-surface)] p-6">
      <SignInForm mode="sign-up" />
    </main>
  );
}
