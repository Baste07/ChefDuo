export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_PIXELS = 6000000;

const crcTable = Uint32Array.from({length:256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});

// Validate the complete container, then omit ancillary metadata only from the
// decoder input. Uploaded and checksummed bytes remain the original file.
export function pngPixels(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept = [bytes.subarray(0,8)];
  let offset = 8, complete = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) throw new Error('Truncated PNG chunk.');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let crc = 0xffffffff;
    for (let index = offset + 4; index < offset + 8 + length; index++) crc = crcTable[(crc ^ bytes[index]) & 255] ^ crc >>> 8;
    if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(offset + 8 + length)) throw new Error('PNG checksum mismatch.');
    if (['IHDR','PLTE','IDAT','IEND','tRNS'].includes(type)) kept.push(bytes.subarray(offset, offset + length + 12));
    else if (!(bytes[offset + 4] & 32)) throw new Error('Unsupported critical PNG chunk.');
    offset += length + 12;
    if (type === 'IEND') {complete = true;break;}
  }
  if (!complete || offset !== bytes.length) throw new Error('Invalid PNG ending.');
  const result = new Uint8Array(kept.reduce((sum, chunk) => sum + chunk.length,0));
  let position = 0;
  for (const chunk of kept) {result.set(chunk,position);position += chunk.length;}
  return result;
}

function checkedDimensions(width, height, mime) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) {
    throw new Error('Image dimensions exceed the 6 megapixel budget. Resize the photograph before uploading.');
  }
  return {width, height, mime};
}

export function inspectImage(bytes) {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Choose an image up to 5 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset, count) => String.fromCharCode(...bytes.subarray(offset, offset + count));
  if (bytes.length > 24 && text(1, 3) === 'PNG' && bytes[0] === 137) {
    if (text(12, 4) !== 'IHDR') throw new Error('Invalid PNG header.');
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) throw new Error('Truncated PNG chunk.');
      if (text(offset + 4, 4) === 'acTL') throw new Error('Animated images are unsupported.');
      offset += length + 12;
      if (text(offset - length - 8, 4) === 'IEND') break;
    }
    return checkedDimensions(view.getUint32(16), view.getUint32(20), 'image/png');
  }
  if (bytes.length > 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error('Invalid WebP container size.');
    let dimensions;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = text(offset, 4), length = view.getUint32(offset + 4, true), start = offset + 8;
      if (length > bytes.length - start) throw new Error('Truncated WebP chunk.');
      if (type === 'ANIM' || type === 'ANMF') throw new Error('Animated images are unsupported.');
      if (type === 'VP8X' && length >= 10) {
        if (bytes[start] & 2) throw new Error('Animated images are unsupported.');
        const uint24 = i => bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16;
        dimensions = checkedDimensions(uint24(start + 4) + 1, uint24(start + 7) + 1, 'image/webp');
      }
      if (type === 'VP8 ' && length >= 10 && text(start + 3, 3) === '\x9d\x01\x2a') {
        dimensions ??= checkedDimensions(view.getUint16(start + 6, true) & 16383, view.getUint16(start + 8, true) & 16383, 'image/webp');
      }
      if (type === 'VP8L' && length >= 5 && bytes[start] === 47) {
        const bits = view.getUint32(start + 1, true);
        dimensions ??= checkedDimensions((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1, 'image/webp');
      }
      offset = start + length + (length % 2);
    }
    if (!dimensions) throw new Error('Missing WebP image dimensions.');
    return dimensions;
  }
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset++] !== 255) throw new Error('Invalid JPEG marker.');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error('Truncated JPEG marker.');
      if ([192,193,194].includes(marker) && length >= 8) return checkedDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3), 'image/jpeg');
      offset += length;
    }
  }
  throw new Error('Use a valid JPEG, PNG or WebP image.');
}

export function createImageDecoder(loadCodec) {
  const codecs = new Map();
  return async bytes => {
    const expected = inspectImage(bytes);
    if (!codecs.has(expected.mime)) codecs.set(expected.mime, loadCodec(expected.mime));
    let codec;
    try {codec = await codecs.get(expected.mime);} catch (error) {codecs.delete(expected.mime);throw error;}
    const pixels = expected.mime === 'image/png' ? pngPixels(bytes) : bytes;
    const image = await codec(pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength));
    if (!image || image.width !== expected.width || image.height !== expected.height || image.data?.length !== expected.width * expected.height * 4) {
      throw new Error('Decoded image does not match its header.');
    }
    return expected;
  };
}
