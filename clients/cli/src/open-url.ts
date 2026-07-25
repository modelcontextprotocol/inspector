import open from "open";

/** Open a URL in the user's default browser (best-effort). */
export async function openUrl(url: string | URL): Promise<void> {
  await open(typeof url === "string" ? url : url.href);
}
