import fs from 'node:fs';

export async function openFileSource(filePath, { highWaterMark = 256 * 1024 } = {}) {
  const { size } = await fs.promises.stat(filePath);
  return {
    size,
    stream() {
      return fs.createReadStream(filePath, { highWaterMark });
    },
    async read(start, end) {
      const length = end - start;
      const buffer = Buffer.alloc(length);
      const handle = await fs.promises.open(filePath, 'r');
      try {
        let offset = 0;
        while (offset < length) {
          const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        return buffer.subarray(0, offset);
      } finally {
        await handle.close();
      }
    },
  };
}

export function bytesSource(input, { highWaterMark = 256 * 1024 } = {}) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return {
    size: data.length,
    async *stream() {
      for (let offset = 0; offset < data.length; offset += highWaterMark) {
        yield data.subarray(offset, Math.min(data.length, offset + highWaterMark));
      }
    },
    async read(start, end) {
      const from = Math.max(0, start);
      const to = Math.min(data.length, end);
      return data.subarray(from, Math.max(from, to));
    },
  };
}
