import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/src/lib/auth-server";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!(await isAuthenticated())) {
    redirect("/sign-in");
  }

  return <>{children}</>;
}
