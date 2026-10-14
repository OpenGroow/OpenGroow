# Source: `image-post`

Turn the image posts of `engage` session reports into `image-post` Sources.

Read `posts[]` of `missions/<missionId>/artifacts/<runId>/report.json` for each Run listed in the run file. Keep the entries whose decision is `liked`, `commented` or `liked_and_commented`, and write one Source per kept entry in the `sources` array of your result file, with `sourceId: "image-post"` and `templateId: "@opengroow/engagement"`, following the JSON Schema of the run file.

Nothing to write is a success too, with `"sources": []`.
