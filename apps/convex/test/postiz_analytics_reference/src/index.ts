export { postizAnalytics } from "./postiz-analytics";

// The bundle contract (ADR-078): the package's default export is the adapter.
import { postizAnalytics as adapter } from "./postiz-analytics";
export default adapter;
