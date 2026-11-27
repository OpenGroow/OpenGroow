import { FileText, ImageIcon, Video } from "lucide-react";

/** The icon of a content format (video, image, anything else a document). */
export function formatIcon(contentType: string) {
  if (contentType === "video") return Video;
  if (contentType === "image") return ImageIcon;
  return FileText;
}
