export { postizAnalytics } from "./postiz_analytics";

// The bundle contract (ADR-078): the package's default export is the adapter.
import { postizAnalytics as adapter } from "./postiz_analytics";
export default adapter;
