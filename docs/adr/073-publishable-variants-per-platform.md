# ADR-073: A Publishable image or carousel may carry one variant per platform, and a Mission type may limit its platforms

**Status:** Accepted

## Context

ADR-069 gave the Publishable one set of media and one `caption`, enough for a video: one file serves every channel. A visual is different. An MCP such as `social-visual-mcp` renders a carousel once per service, because the aspect ratio changes (Instagram 4:5, TikTok 9:16, Pinterest 2:3) and a layout cannot be cropped without breaking it, and each platform has its own text (a TikTok title, a Pinterest title, description and link). The Publisher chooses the channels on the Mission, so one Mission must be able to publish the right images and the right text to each channel.

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

- The key is the channel's platform (`instagram`, `tiktok`…), free: the MCP decides the platforms it serves. `instagram-standalone` falls back to `instagram`.
- A variant carries a complete set of media and may override `caption`, `title`, `link` and `altText`.
- **Selection at the core**, in `publishableForPlatform`, before the plugin is called: a Publisher plugin never sees `variants` and its contract does not change. A channel with no variant gets the default media. With variants only, a channel they do not name is refused with an explicit message, before any Publication exists (`publications.beginAll`), and again when sending.
- **Asynchronous MCP:** `variants` is a media field of `publish.resource`: the tool returns it, text included, and OpenGroow merges it. The Agent's own fields still win; the Agent never writes `variants`. This is the one case where text comes from the MCP: the MCP validated it against the limits of each service when the Agent launched the job.
- A kind without variants, and every Publishable stored before this ADR, is unchanged.

## A Mission type may limit its platforms

`publish.platforms` lists the platforms the content can go to, among the identifiers of `PLATFORM_IDS` (`@opengroow/publisher-sdk`, the vocabulary of the Publishers: today the Postiz providers). It is optional: absent, every channel that can carry the kind is allowed. A channel is compared by its platform (`channelService`), as is or by family (`instagram` covers `instagram-standalone`).

```yaml
publish:
  kind: carousel
  platforms: [instagram, tiktok]
```

- **Why in the manifest:** the rule is fixed and known before anything is rendered (a carousel goes to Instagram and TikTok, a single image to Instagram and Pinterest), so the picker can disable the other channels from the creation of the Mission, with the reason, and the server refuses them (`missions.create`, `schedules`, `publications.beginAll`). The check by variants stays as a safety net: a Project can have disabled a platform the Mission type allows.
- **Why a closed list:** `template:validate` and the hub CI refuse an unknown identifier (`"tiktkok" is not a known platform — one of …`), so a typo cannot silently disable every channel. A new platform adds its identifier to `PLATFORM_IDS`, and the bundled `@opengroow/groowhub-cli` is republished. A test pins the list to the reference Postiz capabilities.
- **At run time:** a declared platform no channel of the installed Publisher is on is reported on the Mission (`This Mission type publishes to TikTok, but this Publisher has no such channel`).
- It does not declare destinations: `targets` stays refused (ADR-069). The human still chooses the channels.

## Considered options

- **One shared format for every channel.** Loses the format that drives visibility and the per-service text.
- **One Mission type per service.** Several renders and reviews for one piece of content.
- **Resizing in the Publisher plugin.** The images are rendered layouts: a post-hoc crop breaks them, and a plugin is not an image processor.

## Consequences

- A visual MCP serving only three services cannot be published to others: that is the intended strictness, and the refusal says which services it was made for.
- The Instagram first comment has no field in the Publishable and is not carried.
- The review shows every variant.
