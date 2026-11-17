'use strict';
// Remove only optional software labels in our newly encoded MP4/MOV.
// Read atom headers, never load the media payload; preserve all atom sizes/offsets.
const fs = require('node:fs/promises');
async function cleanSoftwareTags(file) {
  const handle = await fs.open(file, 'r+');
  const removed = [];
  let count = 0;
  try {
    const size = (await handle.stat()).size;
    const zeros = Buffer.alloc(65536);
    const zero = async (from, to) => {
      while (from < to) {
        const length = Math.min(zeros.length, to - from);
        await handle.write(zeros, 0, length, from);
        from += length;
      }
    };
    const walk = async (start, end, sampleEntries = false) => {
      for (let offset = start; offset < end;) {
        if (++count > 100000 || end - offset < 8) throw Error('Повреждена структура контейнера');
        const head = Buffer.alloc(16);
        const read = await handle.read(head, 0, Math.min(16, end - offset), offset);
        if (read.bytesRead < 8) throw Error('Не удалось прочитать заголовок контейнера');
        let length = head.readUInt32BE(0), header = 8;
        if (length === 1) {
          if (read.bytesRead < 16) throw Error('Повреждён расширенный заголовок');
          const big = head.readBigUInt64BE(8);
          if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Контейнер слишком большой');
          length = Number(big); header = 16;
        } else if (length === 0) length = end - offset;
        if (length < header || offset + length > end) throw Error('Недопустимый размер атома');
        const type = head.toString('latin1', 4, 8), payload = offset + header;
        if (type === '\xa9too') {
          await handle.write(Buffer.from('free'), 0, 4, offset + 4);
          await zero(payload, offset + length);
          removed.push('encoder (©too)');
        } else if (sampleEntries && ['avc1','avc3','hvc1','hev1','mp4v'].includes(type) && length >= 86) {
          await zero(offset + 50, offset + 82);
          removed.push('compressorName');
        } else if (type === 'stsd') await walk(payload + 8, offset + length, true);
        else if (type === 'meta') await walk(payload + 4, offset + length);
        else if (['moov','trak','mdia','minf','stbl','edts','dinf','udta','ilst'].includes(type)) await walk(payload, offset + length);
        offset += length;
      }
    };
    await walk(0, size);
    return removed;
  } finally { await handle.close(); }
}
module.exports = { cleanSoftwareTags };
