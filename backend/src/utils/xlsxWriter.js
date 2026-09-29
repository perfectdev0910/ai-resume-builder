/**
 * Minimal .xlsx writer — no dependencies.
 *
 * Produces a single-sheet workbook with a bold frozen header row, column widths, an
 * autofilter and real hyperlinks. Entries are stored uncompressed (STORED) inside the
 * zip, which Excel, LibreOffice and Google Sheets all accept.
 *
 * buildXlsx({ sheetName, columns, rows }) -> Buffer
 *   columns: [{ header, width, key }]
 *   rows:    [{ key: value | { text, link } | number }]
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const bytesOf = (text) => Buffer.from(String(text), 'utf8');

// Minimal ZIP (STORED entries only).
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const file of files) {
    const nameBytes = bytesOf(file.name);
    const data = file.data;
    const crc = crc32(data);
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), // time, date
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0)
    ];
    chunks.push(Buffer.from(local), nameBytes, data);
    central.push({ name: nameBytes, crc, size: data.length, offset });
    offset += local.length + nameBytes.length + data.length;
  }

  const dirChunks = [];
  let dirSize = 0;
  for (const entry of central) {
    const header = [
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(entry.crc), ...u32(entry.size), ...u32(entry.size),
      ...u16(entry.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(entry.offset)
    ];
    dirChunks.push(Buffer.from(header), entry.name);
    dirSize += header.length + entry.name.length;
  }

  const end = Buffer.from([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(central.length), ...u16(central.length),
    ...u32(dirSize), ...u32(offset), ...u16(0)
  ]);

  return Buffer.concat([...chunks, ...dirChunks, end]);
}

// Control characters are not legal in XML 1.0 and would make the file unreadable.
const escapeXml = (value) => String(value ?? '')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function columnLetter(index) {
  let n = index;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function buildXlsx({ sheetName = 'Sheet1', columns, rows }) {
  const lastCol = columnLetter(columns.length);
  const hyperlinks = [];
  const sheetRows = [];

  sheetRows.push(
    `<row r="1" spans="1:${columns.length}">` +
    columns.map((c, i) => `<c r="${columnLetter(i + 1)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${escapeXml(c.header)}</t></is></c>`).join('') +
    '</row>'
  );

  rows.forEach((row, rowIndex) => {
    const r = rowIndex + 2;
    const cells = columns.map((col, i) => {
      const ref = `${columnLetter(i + 1)}${r}`;
      let value = row[col.key];
      let style = '';
      if (value && typeof value === 'object' && value.link) {
        hyperlinks.push({ ref, target: value.link });
        style = ' s="2"';
        value = value.text || value.link;
      } else if (value && typeof value === 'object') {
        value = value.text ?? '';
      }
      if (value === null || value === undefined || value === '') return `<c r="${ref}"${style}/>`;
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('');
    sheetRows.push(`<row r="${r}" spans="1:${columns.length}">${cells}</row>`);
  });

  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 18}" customWidth="1"/>`).join('');
  const links = hyperlinks.length
    ? `<hyperlinks>${hyperlinks.map((h, i) => `<hyperlink ref="${h.ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>`
    : '';

  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${sheetRows.join('')}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}1"/>` +
    links +
    '</worksheet>';

  const sheetRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    hyperlinks.map((h, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(h.target)}" TargetMode="External"/>`).join('') +
    '</Relationships>';

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '<font><u/><color rgb="FF1D4ED8"/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEFF1F5"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  const files = [
    {
      name: '[Content_Types].xml',
      data: bytesOf(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'
      )
    },
    {
      name: '_rels/.rels',
      data: bytesOf(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
      )
    },
    {
      name: 'xl/workbook.xml',
      data: bytesOf(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${escapeXml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>` +
        '</workbook>'
      )
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: bytesOf(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'
      )
    },
    { name: 'xl/styles.xml', data: bytesOf(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: bytesOf(sheetXml) }
  ];
  if (hyperlinks.length) files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: bytesOf(sheetRels) });

  return zip(files);
}

module.exports = { buildXlsx, zip, crc32 };
