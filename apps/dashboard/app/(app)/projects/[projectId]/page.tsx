import { redirect } from "next/navigation";
import { projectHomePath } from "@/src/lib/project-paths";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  redirect(projectHomePath(projectId));
}
