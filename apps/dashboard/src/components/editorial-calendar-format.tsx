import { FileText, ImageIcon, Video } from "lucide-react";

/** The icon of a content format (video, image, anything else a document). */
export function formatIcon(kind: string) {
  if (kind === "video") return Video;
  if (kind === "image") return ImageIcon;
  return FileText;
}
