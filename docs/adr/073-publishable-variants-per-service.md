# ADR-073: A Publishable image or carousel may carry one variant per service

**Status:** Accepted

## Context

ADR-069 gave the Publishable one set of media and one `caption`, enough for a video: one file serves every channel. A visual is different. An MCP such as `social-visual-mcp` renders a carousel once per service, because the aspect ratio changes (Instagram 4:5, TikTok 9:16, Pinterest 2:3) and a layout cannot be cropped without breaking it, and each service has its own text (a TikTok title, a Pinterest title, description and link). The Publisher chooses the channels on the Mission, so one Mission must be able to publish the right images and the right text to each channel.

## Decision

An `image` or `carousel` Publishable has either its default media (`imageUrl`, `slideUrls`), or `variants`, or both. At least one of the two is required; the schema refuses neither.

```json
{
  "kind": "carousel",
  "caption": "default text",
  "variants": {
    "instagram": { "slideUrls": ["…/ig-1.png"], "caption": "…" },
    "pinterest": { "slideUrls": ["…/pin-1.png"], "title": "…", "caption": "…", "link": "https://…" }
  }
}
```

- The key is the channel's service (`instagram`, `tiktok`…), free: the MCP decides the services it serves. `instagram-standalone` falls back to `instagram`.
- A variant carries a complete set of media and may override `caption`, `title`, `link` and `altText`.
- **Selection at the core**, in `publishableForService`, before the plugin is called: a Publisher plugin never sees `variants` and its contract does not change. A channel with no variant gets the default media. With variants only, a channel they do not name is refused with an explicit message, before any Publication exists (`publications.beginAll`), and again when sending.
- **Asynchronous MCP:** `variants` is a media field of `publish.resource`: the tool returns it, text included, and OpenGroow merges it. The Agent's own fields still win; the Agent never writes `variants`. This is the one case where text comes from the MCP: the MCP validated it against the limits of each service when the Agent launched the job.
- A kind without variants, and every Publishable stored before this ADR, is unchanged.

## Considered options

- **One shared format for every channel.** Loses the format that drives visibility and the per-service text.
- **One Mission type per service.** Several renders and reviews for one piece of content.
- **Resizing in the Publisher plugin.** The images are rendered layouts: a post-hoc crop breaks them, and a plugin is not an image processor.

## Consequences

- A visual MCP serving only three services cannot be published to others: that is the intended strictness, and the refusal says which services it was made for.
- The Instagram first comment has no field in the Publishable and is not carried.
- The review shows every variant.
