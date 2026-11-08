// The host refuses request bodies over about 4.5 MB, which many phone photos are; the
// server re-encodes anyway, so a 2000px JPEG loses nothing it would keep
const UPLOAD_MAX_SIDE = 2000;

/** A photo resized in the browser before upload; browser-only. */
export async function shrinkForUpload(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.88)
    );
    return blob ?? file;
  } catch {
    // A format the browser can't draw goes up as is, and the server says if it's too big
    return file;
  }
}
