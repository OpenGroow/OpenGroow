import { notFound } from "next/navigation";

/**
 * The Template id an `agents/[templateId]` route segment points at. A
 * malformed escape (a literal "%") is an unknown Agent, not a crash: the route
 * 404s. Whether the Project offers that Template is decided client-side from
 * the Project's manifests.
 */
export function templateIdFromSegment(encodedTemplateId: string): string {
  try {
    return decodeURIComponent(encodedTemplateId);
  } catch {
    notFound();
  }
}
