// Signature templates stay in this browser's IndexedDB, separate from PDFs.
const DB_NAME = 'folio-signatures';
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('templates');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Signature storage is unavailable in this browser.'));
  });
}
async function transact(mode, run) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('templates', mode);
      const request = run(tx.objectStore('templates'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('Could not save the signature template. Browser storage may be full.'));
    });
  } finally { db.close(); }
}
export const loadSignature = () => transact('readonly', store => store.get('default'));
export const saveSignature = value => transact('readwrite', store => store.put(value, 'default'));
export const removeSignature = () => transact('readwrite', store => store.delete('default'));

export function adjustSignaturePixels(data, settings = {}) {
  const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
  const background = rgb(settings.backgroundColor || '#ffffff');
  const ink = rgb(settings.inkColor || '#000000');
  const tolerance = Math.max(0, Math.min(150, Number(settings.tolerance ?? 25)));
  for (let i=0; i<data.length; i+=4) {
    if (settings.removeBackground) {
      const distance = Math.max(...background.map((c,j) => Math.abs(data[i+j]-c)));
      const coverage = Math.max(0, Math.min(1, (distance-tolerance)/20));
      data[i+3] = Math.round(data[i+3]*coverage);
    }
    if (settings.recolor) for(let j=0;j<3;j++) data[i+j]=ink[j];
  }
  return data;
}

export async function prepareSignature(file, settings = {}) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a signature image smaller than 10 MB.');
  if (!/\.(png|jpe?g|bmp|webp)$/i.test(file.name)) throw new Error('Choose a PNG, JPG, BMP, or WebP image from Paint.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { throw new Error('This image could not be read. Save it as PNG in Paint and try again.'); }
    if (image.naturalWidth * image.naturalHeight > 24000000) throw new Error('Image is too large. Crop it around your signature in Paint first.');
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (settings.removeBackground || settings.recolor) {
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      adjustSignaturePixels(pixels.data, settings);
      ctx.putImageData(pixels, 0, 0);
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not prepare the signature image.');
    return { name: file.name, blob, source: file, settings: {...settings}, width: canvas.width, height: canvas.height };
  } finally { URL.revokeObjectURL(url); }
}
