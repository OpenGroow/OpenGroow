export { postizPlugin, postizManifest } from "./postiz";

// The bundle contract (ADR-072): the package's default export is the plugin.
import { postizPlugin as plugin } from "./postiz";
export default plugin;
