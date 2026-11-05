// Options of a Publisher channel, per service. They end up in the `settings`
// of the post at the service (Postiz: https://docs.postiz.com/public-api/providers/).
// OpenGroow applies working defaults (apps/convex/publisher/postiz_settings.ts);
// a value set here overrides the default. A service without options has none.

export type ChannelOption =
  | { key: string; label: string; type: "select"; options: Array<{ value: string; label: string }>; default: string }
  | { key: string; label: string; type: "boolean"; default: boolean }
  | { key: string; label: string; type: "text"; placeholder?: string };

export const CHANNEL_OPTIONS: Record<string, ChannelOption[]> = {
  tiktok: [
    {
      key: "privacy_level",
      label: "Visibility",
      type: "select",
      default: "PUBLIC_TO_EVERYONE",
      options: [
        { value: "PUBLIC_TO_EVERYONE", label: "Everyone" },
        { value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends (mutual follows)" },
        { value: "FOLLOWER_OF_CREATOR", label: "Followers" },
        { value: "SELF_ONLY", label: "Only me" },
      ],
    },
    {
      key: "content_posting_method",
      label: "Posting method",
      type: "select",
      default: "DIRECT_POST",
      options: [
        { value: "DIRECT_POST", label: "Publish directly" },
        { value: "UPLOAD", label: "Send to the TikTok inbox (publish it in the app within 24h)" },
      ],
    },
    { key: "comment", label: "Allow comments", type: "boolean", default: true },
    { key: "duet", label: "Allow duets (videos)", type: "boolean", default: true },
    { key: "stitch", label: "Allow stitches (videos)", type: "boolean", default: true },
  ],
  instagram: [
    {
      key: "post_type",
      label: "Post type",
      type: "select",
      default: "post",
      options: [
        { value: "post", label: "Feed post or Reel" },
        { value: "story", label: "Story" },
      ],
    },
  ],
  pinterest: [{ key: "board", label: "Board ID", type: "text", placeholder: "1234567890123456789" }],
};

export function optionsOf(service: string | undefined): ChannelOption[] {
  return (service && CHANNEL_OPTIONS[service]) || [];
}
