/** An `http(s)` URL, as opposed to a search keyword or other non-web origin. */
export function isWebUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}
