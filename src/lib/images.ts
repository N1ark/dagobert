/** Copying and sharing a picture shown in a note or in the media viewer. */
import { toast } from "purr";
import { t } from "./i18n";

async function blobOf(src: string): Promise<Blob> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(res.statusText);
  return res.blob();
}

/** WebKit's clipboard only takes PNG, so anything else is redrawn as one. */
async function pngOf(src: string): Promise<Blob> {
  const blob = await blobOf(src);
  if (blob.type === "image/png") return blob;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight });
    canvas.getContext("2d")?.drawImage(img, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copyImage(src: string) {
  try {
    // A promise, not a blob: Safari wants `write` called within the click, before the fetch.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngOf(src) })]);
    toast.success(t("media.copied"));
  } catch (e) {
    console.error(e);
    toast.error(t("media.copyFailed"));
  }
}

/** Whether the system share sheet is there (WKWebView on iOS has it; it holds Save Image). */
export const canShare = (): boolean => typeof navigator !== "undefined" && typeof navigator.share === "function";

/** A picture as a file for the share sheet, fetched ahead: `share` must be called right in the tap. */
export async function shareable(src: string, name: string): Promise<File> {
  const blob = await blobOf(src);
  return new File([blob], name, { type: blob.type });
}

export function share(file: File) {
  navigator.share({ files: [file] }).catch((e: unknown) => {
    if (e instanceof DOMException && e.name === "AbortError") return;
    console.error(e);
  });
}
