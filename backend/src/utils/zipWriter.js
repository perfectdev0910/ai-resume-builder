/**
 * ZIP writer — deflate via node:zlib, no dependency.
 *
 * Shared by the application-history export: entries are named "<folder>/<file>", which
 * every unzip tool turns back into folders.
 *
 * Entries are stored under the path you give them, so "Acme Inc/Jane_Doe.pdf" becomes a
 * folder in every unzip tool. Large member support (zip64) is not needed here: a batch of
 * resumes is a few megabytes.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time, which is what the zip format stores. */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

/**
 * entries: [{ name, data }]  (name uses forward slashes; folders come from the path)
 */
function buildZip(entries, { modifiedAt = new Date() } = {}) {
  const { time, date } = dosDateTime(modifiedAt);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const deflated = zlib.deflateRawSync(raw, { level: 6 });
    // PDFs and DOCX files are compressed already; storing them is smaller than a wrapper.
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);                 // version needed
    local.writeUInt16LE(0x0800, 6);             // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBytes, data);
    central.push({ nameBytes, crc, compressed: data.length, size: raw.length, method, offset });
    offset += local.length + nameBytes.length + data.length;
  }

  const dirChunks = [];
  let dirSize = 0;
  for (const e of central) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);                // version made by
    header.writeUInt16LE(20, 6);                // version needed
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(e.method, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(e.crc, 16);
    header.writeUInt32LE(e.compressed, 20);
    header.writeUInt32LE(e.size, 24);
    header.writeUInt16LE(e.nameBytes.length, 28);
    header.writeUInt32LE(0, 38);                // external attributes
    header.writeUInt32LE(e.offset, 42);
    dirChunks.push(header, e.nameBytes);
    dirSize += header.length + e.nameBytes.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, ...dirChunks, end]);
}

/** Collects a directory into zip entries, keeping the folder structure. */
function entriesFromDirectory(dir, prefix = '') {
  const entries = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) entries.push(...entriesFromDirectory(full, name));
    else entries.push({ name, data: fs.readFileSync(full) });
  }
  return entries;
}

module.exports = { buildZip, entriesFromDirectory, crc32 };
