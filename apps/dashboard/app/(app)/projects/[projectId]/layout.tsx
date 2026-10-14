import type { ReactNode } from "react";
import { isSelfHost } from "@/src/lib/self-host";
import ProjectLayoutClient from "./project-layout-client";

type LayoutProps = {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
};

export default function ProjectLayout({ children, params }: LayoutProps) {
  return (
    <ProjectLayoutClient params={params} isSelfHost={isSelfHost()}>
      {children}
    </ProjectLayoutClient>
  );
}
