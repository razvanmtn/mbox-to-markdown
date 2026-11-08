export function blobSource(file) {
  return {
    size: file.size,
    stream() {
      return file.stream();
    },
    async read(start, end) {
      const buffer = await file.slice(start, end).arrayBuffer();
      return new Uint8Array(buffer);
    },
  };
}
