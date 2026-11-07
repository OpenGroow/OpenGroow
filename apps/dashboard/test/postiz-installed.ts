// What `api.publisher_packages.list` returns once the Postiz package is installed (ADR-072):
// the dashboard gets capabilities and channel options as data, not from an import.
import { postizManifest, postizPlugin } from "../../../packages/publisher-postiz/src/index";

export const INSTALLED_PUBLISHERS = [
  {
    adapter: postizManifest.id,
    name: postizManifest.name,
    postUrl: postizManifest.postUrl,
    capabilities: postizPlugin.capabilities,
    channelOptions: postizPlugin.channelOptions,
    packageId: "@opengroow/publisher-postiz",
    version: "1.0.0",
  },
];
export const PUBLISHER_PACKAGES_LIST = "publisher_packages.list";
