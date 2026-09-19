/**
 * Renders resume + cover letter documents (DOCX and PDF) in one of several visual styles.
 * Returns buffers only — cvGenerator.js / cvGenerator.cloud.js decide where files are stored.
 *
 * "classic" reproduces the original layout exactly and is the default.
 */
const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, ShadingType } = require('docx');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// ----------------------------------------------------------------------------
// Style definitions
// ----------------------------------------------------------------------------
// Colours are hex without '#'. Sizes: docx half-points, pdf points.
const STYLES = {
  classic: {
    id: 'classic',
    name: 'Classic',
    description: 'Clean black-and-white, centered header, uppercase section titles. ATS-safe.',
    font: 'sans',
    accent: '000000',
    text: '000000',
    muted: '666666',
    link: '0066cc',
    headerAlign: 'center',
    headerBand: false,
    headingCase: 'upper',
    headingRule: 'none',
    scale: 1
  },
  modern: {
    id: 'modern',
    name: 'Modern',
    description: 'Left-aligned header, navy accents and thin rules under each section.',
    font: 'sans',
    accent: '1f3a5f',
    text: '1f2937',
    muted: '6b7280',
    link: '1d4ed8',
    headerAlign: 'left',
    headerBand: false,
    headingCase: 'upper',
    headingRule: 'line',
    scale: 1
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Airy layout with small, understated headings and soft grey details.',
    font: 'sans',
    accent: '374151',
    text: '111827',
    muted: '9ca3af',
    link: '4b5563',
    headerAlign: 'left',
    headerBand: false,
    headingCase: 'upper',
    headingRule: 'none',
    headingSmall: true,
    scale: 1
  },
  executive: {
    id: 'executive',
    name: 'Executive',
    description: 'Traditional serif typography with a double rule under the header.',
    font: 'serif',
    accent: '2b2b2b',
    text: '1a1a1a',
    muted: '555555',
    link: '1a4d8f',
    headerAlign: 'center',
    headerBand: false,
    headerRule: 'double',
    headingCase: 'upper',
    headingRule: 'line',
    scale: 1
  },
  bold: {
    id: 'bold',
    name: 'Bold',
    description: 'Dark header band with white name, teal section titles. Stands out.',
    font: 'sans',
    accent: '0f766e',
    text: '111827',
    muted: '6b7280',
    link: '0f766e',
    headerAlign: 'left',
    headerBand: true,
    bandColor: '0f172a',
    bandText: 'ffffff',
    headingCase: 'upper',
    headingRule: 'line',
    scale: 1
  },
  compact: {
    id: 'compact',
    name: 'Compact',
    description: 'Smaller type and tighter spacing to fit more on one page.',
    font: 'sans',
    accent: '1f2937',
    text: '111827',
    muted: '6b7280',
    link: '1d4ed8',
    headerAlign: 'left',
    headerBand: false,
    headingCase: 'upper',
    headingRule: 'line',
    scale: 0.88
  }
};

const DEFAULT_STYLE = 'classic';

function getStyle(id) {
  return STYLES[id] || STYLES[DEFAULT_STYLE];
}

function listStyles() {
  return Object.values(STYLES).map(({ id, name, description }) => ({ id, name, description, isDefault: id === DEFAULT_STYLE }));
}

// ----------------------------------------------------------------------------
// Shared content helpers
// ----------------------------------------------------------------------------
function contactLine(userInfo) {
  return [userInfo.email, userInfo.phone_number, userInfo.address].filter(Boolean).join(' | ');
}

function linkLine(userInfo) {
  const links = [];
  if (userInfo.linkedin_profile) links.push(`LinkedIn: ${userInfo.linkedin_profile}`);
  if (userInfo.github_link) links.push(`GitHub: ${userInfo.github_link}`);
  return links.join(' | ');
}

function skillLines(skills) {
  if (!skills) return [];
  if (Array.isArray(skills)) return [{ category: '', skills: skills.filter(Boolean).join(' • ') }];
  return String(skills)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(':');
      return i > 0 ? { category: line.slice(0, i).trim(), skills: line.slice(i + 1).trim() } : { category: '', skills: line };
    });
}

function jobAchievements(job) {
  return [
    ...(Array.isArray(job.keyAchievements) ? job.keyAchievements : []),
    ...(Array.isArray(job.achievements) ? job.achievements : [])
  ];
}

function heading(style, text) {
  return style.headingCase === 'upper' ? String(text).toUpperCase() : text;
}

function coverParagraphs(content) {
  return [content.opening, content.body, content.companyFit, content.closing].filter(Boolean);
}

function todayLabel() {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ----------------------------------------------------------------------------
// DOCX
// ----------------------------------------------------------------------------
const DOCX_FONTS = { sans: 'Calibri', serif: 'Georgia' };

function docxAlign(style) {
  return style.headerAlign === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT;
}

function docxHeadingBorder(style) {
  if (style.headingRule !== 'line') return undefined;
  return { bottom: { style: BorderStyle.SINGLE, size: 6, color: style.accent, space: 2 } };
}

function buildResumeDocx(cvContent, userInfo, options = {}) {
  const style = getStyle(options.style);
  const { credlyProfileLink, tags } = options;
  const s = (n) => Math.round(n * style.scale);
  const font = DOCX_FONTS[style.font];
  const run = (props) => new TextRun({ font, color: style.text, ...props });
  const sections = [];

  const headerShading = style.headerBand
    ? { shading: { type: ShadingType.CLEAR, fill: style.bandColor, color: 'auto' } }
    : {};
  const headerColor = style.headerBand ? style.bandText : style.accent;

  // --- Header
  sections.push(new Paragraph({
    children: [run({ text: userInfo.full_name, bold: true, size: s(32), color: headerColor })],
    alignment: docxAlign(style),
    spacing: { before: style.headerBand ? 160 : 0, after: 100 },
    ...headerShading
  }));
  sections.push(new Paragraph({
    children: [run({ text: contactLine(userInfo), size: s(20), color: style.headerBand ? style.bandText : style.text })],
    alignment: docxAlign(style),
    spacing: { after: linkLine(userInfo) ? 100 : (style.headerBand ? 160 : 100) },
    ...headerShading
  }));
  if (linkLine(userInfo)) {
    sections.push(new Paragraph({
      children: [run({ text: linkLine(userInfo), size: s(18), color: style.headerBand ? style.bandText : style.link })],
      alignment: docxAlign(style),
      spacing: { after: style.headerBand ? 160 : 200 },
      ...headerShading
    }));
  }
  if (style.headerRule === 'double') {
    sections.push(new Paragraph({
      children: [],
      border: { bottom: { style: BorderStyle.DOUBLE, size: 6, color: style.accent, space: 1 } },
      spacing: { after: 160 }
    }));
  }

  const sectionTitle = (text, before = 200) => new Paragraph({
    children: [run({
      text: heading(style, text),
      bold: true,
      size: style.headingSmall ? s(20) : s(24),
      color: style.accent,
      characterSpacing: style.headingSmall ? 40 : undefined
    })],
    spacing: { before, after: 100 },
    border: docxHeadingBorder(style)
  });

  // --- Summary
  if (cvContent.summary) {
    sections.push(sectionTitle('Professional Summary'));
    sections.push(new Paragraph({ children: [run({ text: cvContent.summary, size: s(22) })], spacing: { after: 200 } }));
  }

  // --- Skills
  const skills = skillLines(cvContent.skills);
  if (skills.length) {
    sections.push(sectionTitle('Skills'));
    for (const line of skills) {
      sections.push(new Paragraph({
        children: line.category
          ? [run({ text: `${line.category}: `, bold: true, size: s(20) }), run({ text: line.skills, size: s(20) })]
          : [run({ text: line.skills, size: s(22) })],
        spacing: { after: 50 }
      }));
    }
  }

  // --- Experience
  if (Array.isArray(cvContent.experience) && cvContent.experience.length) {
    sections.push(sectionTitle('Professional Experience'));
    for (const job of cvContent.experience) {
      sections.push(new Paragraph({
        children: [
          run({ text: job.position || '', bold: true, size: s(22) }),
          run({ text: ` | ${job.company || ''}`, size: s(22), color: style.id === 'classic' ? style.text : style.accent })
        ],
        spacing: { before: 150 }
      }));
      sections.push(new Paragraph({
        children: [run({ text: `${job.location || ''} | ${job.period || ''}`, italics: true, size: s(20), color: style.muted })],
        spacing: { after: 50 }
      }));
      if (job.summary) {
        sections.push(new Paragraph({ children: [run({ text: job.summary, italics: true, size: s(20) })], spacing: { after: 80 } }));
      }
      const responsibilities = Array.isArray(job.responsibilities) ? job.responsibilities : [];
      if (responsibilities.length) {
        sections.push(new Paragraph({ children: [run({ text: 'Responsibilities:', underline: {}, size: s(18) })], spacing: { after: 50 } }));
        for (const item of responsibilities) {
          sections.push(new Paragraph({ children: [run({ text: `• ${item}`, size: s(22) })], indent: { left: 360 } }));
        }
      }
      const achievements = jobAchievements(job);
      if (achievements.length) {
        sections.push(new Paragraph({ children: [run({ text: 'Key Achievements:', underline: {}, size: s(18) })], spacing: { before: 80, after: 50 } }));
        for (const item of achievements) {
          sections.push(new Paragraph({ children: [run({ text: `• ${item}`, size: s(22) })], indent: { left: 360 } }));
        }
      }
    }
  }

  // --- Education
  if (Array.isArray(cvContent.education) && cvContent.education.length) {
    sections.push(sectionTitle('Education', 300));
    for (const edu of cvContent.education) {
      sections.push(new Paragraph({
        children: [run({ text: edu.degree || '', bold: true, size: s(22) }), run({ text: ` - ${edu.institution || ''}`, size: s(22) })]
      }));
      if (edu.graduation || edu.details) {
        sections.push(new Paragraph({
          children: [run({ text: [edu.graduation, edu.details].filter(Boolean).join(' | '), italics: true, size: s(20), color: style.muted })],
          spacing: { after: 100 }
        }));
      }
    }
  }

  // --- Certifications
  if (Array.isArray(cvContent.certifications) && cvContent.certifications.length) {
    sections.push(sectionTitle('Certifications', 300));
    if (credlyProfileLink) {
      sections.push(new Paragraph({ children: [run({ text: `Credly Profile: ${credlyProfileLink}`, size: s(20), color: style.link })], spacing: { after: 100 } }));
    }
    for (const cert of cvContent.certifications) {
      sections.push(new Paragraph({ children: [run({ text: `• ${cert}`, size: s(22) })] }));
    }
  }

  // --- Tags
  if (Array.isArray(tags) && tags.length) {
    sections.push(sectionTitle('Other', 300));
    sections.push(new Paragraph({ children: [run({ text: tags.join(' • '), size: s(22) })] }));
  }

  const margin = style.id === 'compact' ? 600 : 720;
  const doc = new Document({
    styles: { default: { document: { run: { font } } } },
    sections: [{ properties: { page: { margin: { top: margin, right: margin, bottom: margin, left: margin } } }, children: sections }]
  });
  return Packer.toBuffer(doc);
}

function buildCoverLetterDocx(content, userInfo, options = {}) {
  const style = getStyle(options.style);
  const font = DOCX_FONTS[style.font];
  const run = (props) => new TextRun({ font, color: style.text, ...props });
  const sections = [];
  const headerShading = style.headerBand ? { shading: { type: ShadingType.CLEAR, fill: style.bandColor, color: 'auto' } } : {};
  const headerColor = style.headerBand ? style.bandText : style.accent;

  sections.push(new Paragraph({
    children: [run({ text: userInfo.full_name, bold: true, size: 28, color: headerColor })],
    alignment: docxAlign(style),
    spacing: { before: style.headerBand ? 160 : 0, after: 100 },
    ...headerShading
  }));
  sections.push(new Paragraph({
    children: [run({ text: contactLine(userInfo), size: 20, color: style.headerBand ? style.bandText : style.muted })],
    alignment: docxAlign(style),
    spacing: { after: style.headerBand ? 160 : 300 },
    ...headerShading
  }));
  if (style.headerRule === 'double' || style.headingRule === 'line') {
    sections.push(new Paragraph({
      children: [],
      border: { bottom: { style: style.headerRule === 'double' ? BorderStyle.DOUBLE : BorderStyle.SINGLE, size: 6, color: style.accent, space: 1 } },
      spacing: { after: 240 }
    }));
  }

  sections.push(new Paragraph({ children: [run({ text: todayLabel(), size: 22 })], spacing: { after: 300 } }));
  sections.push(new Paragraph({ children: [run({ text: content.salutation || 'Dear Hiring Manager,', size: 22 })], spacing: { after: 200 } }));
  for (const para of coverParagraphs(content)) {
    sections.push(new Paragraph({ children: [run({ text: para, size: 22 })], spacing: { after: 200 } }));
  }
  sections.push(new Paragraph({ children: [run({ text: content.signoff || 'Sincerely,', size: 22 })], spacing: { before: 200, after: 100 } }));
  sections.push(new Paragraph({ children: [run({ text: userInfo.full_name, size: 22, bold: style.id !== 'classic' })], spacing: { after: 100 } }));

  const doc = new Document({
    styles: { default: { document: { run: { font } } } },
    sections: [{ properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children: sections }]
  });
  return Packer.toBuffer(doc);
}

// ----------------------------------------------------------------------------
// PDF
// ----------------------------------------------------------------------------
function hexToRgb(hex) {
  const n = parseInt(hex, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function embedFonts(pdfDoc, style) {
  if (style.font === 'serif') {
    return {
      regular: await pdfDoc.embedFont(StandardFonts.TimesRoman),
      bold: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
      italic: await pdfDoc.embedFont(StandardFonts.TimesRomanItalic)
    };
  }
  return {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique)
  };
}

// Small page-flow helper shared by resume and cover letter.
function createWriter(pdfDoc, fonts, style, { margin, lineHeight, pageSize = [612, 792] }) {
  const width = pageSize[0];
  const height = pageSize[1];
  const state = { page: pdfDoc.addPage(pageSize), y: height - margin };
  const textColor = hexToRgb(style.text);

  const newPage = () => {
    state.page = pdfDoc.addPage(pageSize);
    state.y = height - margin;
  };
  const ensure = (needed) => { if (state.y - needed < margin) newPage(); };

  const wrap = (text, font, size, maxWidth) => {
    const words = String(text).replace(/\n/g, ' ').split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line + word + ' ';
      if (font.widthOfTextAtSize(test, size) > maxWidth && line !== '') {
        lines.push(line.trim());
        line = word + ' ';
      } else {
        line = test;
      }
    }
    lines.push(line.trim());
    return lines;
  };

  const text = (value, opts = {}) => {
    const { x = margin, size = 10, bold = false, italic = false, color = textColor, maxWidth = width - margin * 2 - (opts.x ? opts.x - margin : 0), align = 'left', lh = lineHeight } = opts;
    const font = bold ? fonts.bold : italic ? fonts.italic : fonts.regular;
    for (const l of wrap(value, font, size, maxWidth)) {
      ensure(lh);
      let drawX = x;
      if (align === 'center') drawX = (width - font.widthOfTextAtSize(l, size)) / 2;
      state.page.drawText(l, { x: drawX, y: state.y, size, font, color });
      state.y -= lh;
    }
  };

  const rule = (color, thickness = 1, double = false) => {
    ensure(6);
    state.page.drawLine({ start: { x: margin, y: state.y + 3 }, end: { x: width - margin, y: state.y + 3 }, thickness, color });
    if (double) {
      state.page.drawLine({ start: { x: margin, y: state.y }, end: { x: width - margin, y: state.y }, thickness, color });
    }
    state.y -= 8;
  };

  const band = (h, color) => {
    state.page.drawRectangle({ x: 0, y: height - h, width, height: h, color });
    state.y = height - margin + 4;
  };

  const gap = (n) => { state.y -= n; };

  return { text, rule, band, gap, ensure, state, width, height };
}

async function buildResumePdf(cvContent, userInfo, options = {}) {
  const style = getStyle(options.style);
  const { credlyProfileLink, tags } = options;
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedFonts(pdfDoc, style);
  const sc = style.scale;
  const margin = style.id === 'compact' ? 42 : 50;
  const w = createWriter(pdfDoc, fonts, style, { margin, lineHeight: 14 * sc });
  const accent = hexToRgb(style.accent);
  const muted = hexToRgb(style.muted);
  const link = hexToRgb(style.link);
  const align = style.headerAlign;

  // --- Header
  if (style.headerBand) {
    const bandHeight = 72 + (linkLine(userInfo) ? 14 : 0);
    w.band(bandHeight, hexToRgb(style.bandColor));
    w.state.y = w.height - 30;
    const white = hexToRgb(style.bandText);
    w.text(userInfo.full_name, { size: 18, bold: true, color: white, align });
    w.text(contactLine(userInfo), { size: 9, color: white, align });
    if (linkLine(userInfo)) w.text(linkLine(userInfo), { size: 9, color: white, align });
    w.state.y = w.height - bandHeight - 18;
  } else {
    w.text(userInfo.full_name, { size: 16 * sc + 2, bold: true, color: accent, align });
    w.gap(5);
    w.text(contactLine(userInfo), { size: 9 * sc, align });
    if (linkLine(userInfo)) w.text(linkLine(userInfo), { size: 9 * sc, color: link, align });
    if (style.headerRule === 'double') { w.gap(4); w.rule(accent, 1, true); }
  }

  const section = (title) => {
    w.gap(20 * sc);
    w.ensure(30);
    w.text(heading(style, title), { size: style.headingSmall ? 9 : 12 * sc, bold: true, color: accent });
    if (style.headingRule === 'line') w.rule(accent, 0.8);
    else w.gap(5);
  };

  // --- Summary
  if (cvContent.summary) {
    section('Professional Summary');
    w.text(cvContent.summary, { size: 10 * sc });
  }

  // --- Skills
  const skills = skillLines(cvContent.skills);
  if (skills.length) {
    section('Skills');
    for (const line of skills) {
      w.text(line.category ? `${line.category}: ${line.skills}` : line.skills, { size: 10 * sc });
    }
  }

  // --- Experience
  if (Array.isArray(cvContent.experience) && cvContent.experience.length) {
    section('Professional Experience');
    for (const job of cvContent.experience) {
      w.gap(5);
      w.text(`${job.position || ''} | ${job.company || ''}`, { size: 10 * sc, bold: true });
      w.text(`${job.location || ''} | ${job.period || ''}`, { size: 9 * sc, color: muted, italic: true });
      if (job.summary) w.text(job.summary, { size: 9 * sc, italic: true });
      const responsibilities = Array.isArray(job.responsibilities) ? job.responsibilities : [];
      if (responsibilities.length) {
        w.text('Responsibilities:', { size: 9 * sc });
        for (const item of responsibilities) w.text(`• ${item}`, { x: margin + 10, size: 10 * sc });
      }
      const achievements = jobAchievements(job);
      if (achievements.length) {
        w.text('Key Achievements:', { size: 9 * sc });
        for (const item of achievements) w.text(`• ${item}`, { x: margin + 10, size: 10 * sc });
      }
    }
  }

  // --- Education
  if (Array.isArray(cvContent.education) && cvContent.education.length) {
    section('Education');
    for (const edu of cvContent.education) {
      w.text(`${edu.degree || ''} - ${edu.institution || ''}`, { size: 10 * sc, bold: true });
      if (edu.graduation || edu.details) w.text([edu.graduation, edu.details].filter(Boolean).join(' | '), { size: 9 * sc, color: muted });
    }
  }

  // --- Certifications
  if (Array.isArray(cvContent.certifications) && cvContent.certifications.length) {
    section('Certifications');
    if (credlyProfileLink) w.text(`Credly Profile: ${credlyProfileLink}`, { size: 9 * sc, color: link });
    for (const cert of cvContent.certifications) w.text(`• ${cert}`, { size: 10 * sc });
  }

  // --- Tags
  if (Array.isArray(tags) && tags.length) {
    section('Other');
    w.text(tags.join(' • '), { size: 10 * sc });
  }

  return pdfDoc.save();
}

async function buildCoverLetterPdf(content, userInfo, options = {}) {
  const style = getStyle(options.style);
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedFonts(pdfDoc, style);
  const margin = 72;
  const w = createWriter(pdfDoc, fonts, style, { margin, lineHeight: 16 });
  const accent = hexToRgb(style.accent);
  const muted = hexToRgb(style.muted);
  const align = style.headerAlign;

  if (style.headerBand) {
    w.band(64, hexToRgb(style.bandColor));
    w.state.y = w.height - 28;
    const white = hexToRgb(style.bandText);
    w.text(userInfo.full_name, { size: 15, bold: true, color: white, align });
    w.text(contactLine(userInfo), { size: 10, color: white, align });
    w.state.y = w.height - 64 - 24;
  } else {
    w.text(userInfo.full_name, { size: 14, bold: true, color: accent, align });
    w.gap(5);
    w.text(contactLine(userInfo), { size: 10, color: style.id === 'classic' ? undefined : muted, align });
    if (style.headerRule === 'double') { w.gap(4); w.rule(accent, 1, true); }
    else if (style.headingRule === 'line') { w.gap(4); w.rule(accent, 0.8); }
    w.gap(20);
  }

  w.text(todayLabel(), { size: 11 });
  w.gap(20);
  w.text(content.salutation || 'Dear Hiring Manager,', { size: 11 });
  w.gap(10);
  for (const para of coverParagraphs(content)) {
    w.text(para, { size: 11 });
    w.gap(10);
  }
  w.gap(10);
  w.text(content.signoff || 'Sincerely,', { size: 11 });
  w.gap(5);
  w.text(userInfo.full_name, { size: 11, bold: style.id !== 'classic' });

  return pdfDoc.save();
}

module.exports = {
  STYLES,
  DEFAULT_STYLE,
  getStyle,
  listStyles,
  buildResumeDocx,
  buildResumePdf,
  buildCoverLetterDocx,
  buildCoverLetterPdf
};
