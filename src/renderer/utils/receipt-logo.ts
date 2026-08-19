/**
 * Prepares a user-picked image (logo / QR code) for printing on a thermal receipt.
 *
 * The result is stored as a data URL in the `receipt_logo_top` / `receipt_logo_bottom`
 * settings, which sync to the VPS like every other setting — so the image is downscaled
 * to printer resolution and compressed until it fits a small byte budget.
 */

/** 80 mm paper at 203 DPI is 576 dots; anything wider is wasted on the printer. */
const MAX_WIDTH_PX = 576;
const MAX_HEIGHT_PX = 576;

/** Data-URL byte budget — keeps the settings row (and its sync payload) small. */
const MAX_DATA_URL_BYTES = 200 * 1024;

const JPEG_QUALITY_STEPS = [0.9, 0.8, 0.7, 0.55, 0.4];

export const ACCEPTED_LOGO_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';

/** Rejects files that are far too large to be worth decoding at all (20 MB). */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export class ReceiptLogoError extends Error {
  constructor(public readonly reason: 'type' | 'tooLarge' | 'decode') {
    super(reason);
    this.name = 'ReceiptLogoError';
  }
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ReceiptLogoError('decode'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ReceiptLogoError('decode'));
    img.src = src;
  });
}

/** Approximate decoded size of a base64 data URL, in bytes. */
function dataUrlBytes(dataUrl: string): number {
  return Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
}

/**
 * Decodes, downscales and re-encodes the image. PNG is preferred (sharp edges for
 * logos and QR codes); if PNG blows the byte budget the image is a photo, so it
 * falls back to progressively stronger JPEG compression.
 */
export async function prepareReceiptLogo(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new ReceiptLogoError('type');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ReceiptLogoError('tooLarge');
  }

  const img = await loadImage(await readAsDataURL(file));
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new ReceiptLogoError('decode');
  }

  const scale = Math.min(
    1,
    MAX_WIDTH_PX / img.naturalWidth,
    MAX_HEIGHT_PX / img.naturalHeight
  );
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ReceiptLogoError('decode');

  // Receipt paper is white and thermal printers can't render transparency —
  // flatten onto white so PNG alpha doesn't print as a black block.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  const png = canvas.toDataURL('image/png');
  if (dataUrlBytes(png) <= MAX_DATA_URL_BYTES) return png;

  for (const quality of JPEG_QUALITY_STEPS) {
    const jpeg = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlBytes(jpeg) <= MAX_DATA_URL_BYTES) return jpeg;
  }

  // Even the lowest quality is over budget — the source is unusable for a receipt.
  throw new ReceiptLogoError('tooLarge');
}
