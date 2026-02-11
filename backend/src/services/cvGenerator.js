const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType } = require('docx');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

// Helper function to sanitize filename
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').trim();
}

async function generateDocx(cvContent, userInfo, customFilename = null, options = {}) {
  const { credlyProfileLink, tags } = options;
  const sections = [];

  // Header with contact info
  sections.push(
    new Paragraph({
      children: [
        new TextRun({ text: userInfo.full_name, bold: true, size: 32 })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 }
    })
  );

  // Contact line
  const contactParts = [];
  if (userInfo.email) contactParts.push(userInfo.email);
  if (userInfo.phone_number) contactParts.push(userInfo.phone_number);
  if (userInfo.address) contactParts.push(userInfo.address);

  sections.push(
    new Paragraph({
      children: [new TextRun({ text: contactParts.join(' | '), size: 20 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 }
    })
  );

  // Links
  const links = [];
  if (userInfo.linkedin_profile) links.push(`LinkedIn: ${userInfo.linkedin_profile}`);
  if (userInfo.github_link) links.push(`GitHub: ${userInfo.github_link}`);

  if (links.length > 0) {
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: links.join(' | '), size: 18, color: '0066cc' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 }
      })
    );
  }

  // Professional Summary
  if (cvContent.summary) {
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: 'PROFESSIONAL SUMMARY', bold: true, size: 24 })],
        spacing: { before: 200, after: 100 }
      })
    );
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: cvContent.summary, size: 22 })],
        spacing: { after: 200 }
      })
    );
  }

  // Skills
  if (cvContent.skills) {
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: 'SKILLS', bold: true, size: 24 })],
        spacing: { before: 200, after: 100 }
      })
    );
    
    // Handle skills as either string (new format) or array (legacy format)
    if (typeof cvContent.skills === 'string') {
      // New format: skills as categorized string with newlines
      const skillLines = cvContent.skills.split('\n').filter(line => line.trim());
      for (const line of skillLines) {
        // Check if line has a category prefix (e.g., "Programming Languages: Java, Python")
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const category = line.substring(0, colonIndex).trim();
          const skills = line.substring(colonIndex + 1).trim();
          sections.push(
            new Paragraph({
              children: [
                new TextRun({ text: category + ': ', bold: true, size: 20 }),
                new TextRun({ text: skills, size: 20 })
              ],
              spacing: { after: 50 }
            })
          );
        } else {
          sections.push(
            new Paragraph({
              children: [new TextRun({ text: line, size: 20 })],
              spacing: { after: 50 }
            })
          );
        }
      }
    } else if (Array.isArray(cvContent.skills)) {
      // Legacy format: skills as array
      sections.push(
        new Paragraph({
          children: [new TextRun({ text: cvContent.skills.join(' • '), size: 22 })],
          spacing: { after: 200 }
        })
      );
    }
  }

  // Experience
  if (cvContent.experience && cvContent.experience.length > 0) {
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: 'PROFESSIONAL EXPERIENCE', bold: true, size: 24 })],
        spacing: { before: 200, after: 100 }
      })
    );

    for (const job of cvContent.experience) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: job.position, bold: true, size: 22 }),
            new TextRun({ text: ` | ${job.company}`, size: 22 })
          ],
          spacing: { before: 150 }
        })
      );
      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${job.location || ''} | ${job.period || ''}`, italics: true, size: 20, color: '666666' })
          ],
          spacing: { after: 50 }
        })
      );

      if (job.achievements && job.achievements.length > 0) {
        for (const achievement of job.achievements) {
          sections.push(
            new Paragraph({
              children: [new TextRun({ text: `• ${achievement}`, size: 22 })],
              indent: { left: 360 }
            })
          );
        }
      }
    }
  }

  // Education
  if (cvContent.education && cvContent.education.length > 0) {
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: 'EDUCATION', bold: true, size: 24 })],
        spacing: { before: 300, after: 100 }
      })
    );

    for (const edu of cvContent.education) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: edu.degree, bold: true, size: 22 }),
            new TextRun({ text: ` - ${edu.institution}`, size: 22 })
          ]
        })
      );
      if (edu.graduation || edu.details) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: [edu.graduation, edu.details].filter(Boolean).join(' | '), italics: true, size: 20 })
            ],
            spacing: { after: 100 }
          })
        );
      }
    }
  }

  // Certifications
  if (cvContent.certifications && cvContent.certifications.length > 0) {
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: 'CERTIFICATIONS', bold: true, size: 24 })],
        spacing: { before: 300, after: 100 }
      })
    );

    // Add Credly profile link at the top of certifications if available
    if (credlyProfileLink) {
      sections.push(
        new Paragraph({
          children: [new TextRun({ text: `Credly Profile: ${credlyProfileLink}`, size: 20, color: '0066cc' })],
          spacing: { after: 100 }
        })
      );
    }

    for (const cert of cvContent.certifications) {
      sections.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${cert}`, size: 22 })]
        })
      );
    }
  }

  // Tags as "Other" section - this is the LAST section, nothing should come after it
  if (tags && tags.length > 0) {
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: 'OTHER', bold: true, size: 24 })],
        spacing: { before: 300, after: 100 }
      })
    );
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: tags.join(' • '), size: 22 })]
      })
    );
  }

  // NOTE: Do NOT add additionalSections after "Other" section per requirements

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: 720,
            right: 720,
            bottom: 720,
            left: 720
          }
        }
      },
      children: sections
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  // Store with full_name_Resume_UUID format
  const sanitizedName = sanitizeFilename(userInfo.full_name || 'User');
  const filename = `${sanitizedName}_Resume_${uuidv4()}.docx`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(filepath, buffer);

  return { filename, filepath };
}

async function generatePdf(cvContent, userInfo, customFilename = null, options = {}) {
  const { credlyProfileLink, tags } = options;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([612, 792]); // Letter size
  const { height } = page.getSize();
  let y = height - 50;
  const margin = 50;
  const lineHeight = 14;
  const sectionSpacing = 20;

  const drawText = (text, options = {}) => {
    const {
      x = margin,
      size = 10,
      bold = false,
      color = rgb(0, 0, 0),
      maxWidth = 512
    } = options;

    const usedFont = bold ? boldFont : font;

    // Replace newline characters with spaces (you can modify this behavior if needed)
    text = text.replace(/\n/g, ' '); 

    // Simple text wrapping
    const words = text.split(' ');
    let line = '';
    const lines = [];

    for (const word of words) {
      const testLine = line + word + ' ';
      const testWidth = usedFont.widthOfTextAtSize(testLine, size);
      if (testWidth > maxWidth && line !== '') {
        lines.push(line.trim());
        line = word + ' ';
      } else {
        line = testLine;
      }
    }
    lines.push(line.trim());

    for (const l of lines) {
      if (y < 50) {
        page = pdfDoc.addPage([612, 792]);
        y = height - 50;
      }
      page.drawText(l, { x, y, size, font: usedFont, color });
      y -= lineHeight;
    }
  };

  const drawSection = (title) => {
    y -= sectionSpacing;
    if (y < 80) {
      page = pdfDoc.addPage([612, 792]);
      y = height - 50;
    }
    drawText(title.toUpperCase(), { size: 12, bold: true });
    y -= 5;
    // Line removed as per requirement
  };

  // Header
  drawText(userInfo.full_name, { x: 306 - (boldFont.widthOfTextAtSize(userInfo.full_name, 18) / 2), size: 18, bold: true });
  y -= 5;

  // Contact
  const contactParts = [userInfo.email, userInfo.phone_number, userInfo.address].filter(Boolean);
  const contactText = contactParts.join(' | ');
  drawText(contactText, { x: 306 - (font.widthOfTextAtSize(contactText, 9) / 2), size: 9 });

  // Links
  const links = [userInfo.linkedin_profile, userInfo.github_link].filter(Boolean);
  if (links.length > 0) {
    const linksText = links.join(' | ');
    drawText(linksText, { x: 306 - (font.widthOfTextAtSize(linksText, 9) / 2), size: 9, color: rgb(0, 0.4, 0.8) });
  }

  // Summary
  if (cvContent.summary) {
    drawSection('Professional Summary');
    drawText(cvContent.summary);
  }

  // Skills
  if (cvContent.skills) {
    drawSection('Skills');
    // Handle skills as either string (new format) or array (legacy format)
    if (typeof cvContent.skills === 'string') {
      // New format: skills as categorized string with newlines
      const skillLines = cvContent.skills.split('\n').filter(line => line.trim());
      for (const line of skillLines) {
        drawText(line);
      }
    } else if (Array.isArray(cvContent.skills)) {
      // Legacy format: skills as array
      drawText(cvContent.skills.join(' • '));
    }
  }

  // Experience
  if (cvContent.experience && cvContent.experience.length > 0) {
    drawSection('Professional Experience');
    for (const job of cvContent.experience) {
      y -= 5;
      drawText(`${job.position} | ${job.company}`, { bold: true });
      drawText(`${job.location || ''} | ${job.period || ''}`, { size: 9, color: rgb(0.4, 0.4, 0.4) });
      if (job.achievements) {
        for (const ach of job.achievements) {
          drawText(`• ${ach}`, { x: margin + 10 });
        }
      }
    }
  }

  // Education
  if (cvContent.education && cvContent.education.length > 0) {
    drawSection('Education');
    for (const edu of cvContent.education) {
      drawText(`${edu.degree} - ${edu.institution}`, { bold: true });
      if (edu.graduation || edu.details) {
        drawText([edu.graduation, edu.details].filter(Boolean).join(' | '), { size: 9 });
      }
    }
  }

  // Certifications
  if (cvContent.certifications && cvContent.certifications.length > 0) {
    drawSection('Certifications');
    // Add Credly profile link at the top of certifications if available
    if (credlyProfileLink) {
      drawText(`Credly Profile: ${credlyProfileLink}`, { size: 9, color: rgb(0, 0.4, 0.8) });
    }
    for (const cert of cvContent.certifications) {
      drawText(`• ${cert}`);
    }
  }

  // Tags as "Other" section - this is the LAST section, nothing should come after it
  if (tags && tags.length > 0) {
    drawSection('Other');
    drawText(tags.join(' • '));
  }

  // NOTE: Do NOT add additionalSections after "Other" section per requirements

  const pdfBytes = await pdfDoc.save();
  // Store with full_name_Resume_UUID format
  const sanitizedName = sanitizeFilename(userInfo.full_name || 'User');
  const filename = `${sanitizedName}_Resume_${uuidv4()}.pdf`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(filepath, pdfBytes);

  return { filename, filepath };
}

// Generate Cover Letter DOCX
async function generateCoverLetterDocx(coverLetterContent, userInfo, customFilename = null) {
  const sections = [];

  // Header with contact info
  sections.push(
    new Paragraph({
      children: [
        new TextRun({ text: userInfo.full_name, bold: true, size: 28 })
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 100 }
    })
  );

  // Contact line
  const contactParts = [];
  if (userInfo.email) contactParts.push(userInfo.email);
  if (userInfo.phone_number) contactParts.push(userInfo.phone_number);
  if (userInfo.address) contactParts.push(userInfo.address);

  sections.push(
    new Paragraph({
      children: [new TextRun({ text: contactParts.join(' | '), size: 20 })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 300 }
    })
  );

  // Date
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: today, size: 22 })],
      spacing: { after: 300 }
    })
  );

  // Salutation
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: coverLetterContent.salutation || 'Dear Hiring Manager,', size: 22 })],
      spacing: { after: 200 }
    })
  );

  // Body paragraphs
  const paragraphs = [
    coverLetterContent.opening,
    coverLetterContent.body,
    coverLetterContent.companyFit,
    coverLetterContent.closing
  ].filter(Boolean);

  for (const para of paragraphs) {
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: para, size: 22 })],
        spacing: { after: 200 }
      })
    );
  }

  // Sign off
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: coverLetterContent.signoff || 'Sincerely,', size: 22 })],
      spacing: { before: 200, after: 100 }
    })
  );

  sections.push(
    new Paragraph({
      children: [new TextRun({ text: userInfo.full_name, size: 22 })],
      spacing: { after: 100 }
    })
  );

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: 1080,
            right: 1080,
            bottom: 1080,
            left: 1080
          }
        }
      },
      children: sections
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  // Store with full_name_Cover_Letter_UUID format
  const sanitizedName = sanitizeFilename(userInfo.full_name || 'User');
  const filename = `${sanitizedName}_Cover_Letter_${uuidv4()}.docx`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(filepath, buffer);

  return { filename, filepath };
}

// Generate Cover Letter PDF
async function generateCoverLetterPdf(coverLetterContent, userInfo, customFilename = null) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([612, 792]); // Letter size
  const { height } = page.getSize();
  let y = height - 72;
  const margin = 72;
  const lineHeight = 16;

  const drawText = (text, options = {}) => {
    text = text.replace(/\n/g, ' '); 
    const {
      x = margin,
      size = 11,
      bold = false,
      color = rgb(0, 0, 0),
      maxWidth = 468
    } = options;

    const usedFont = bold ? boldFont : font;

    // Simple text wrapping
    const words = text.split(' ');
    let line = '';
    const lines = [];

    for (const word of words) {
      const testLine = line + word + ' ';
      const testWidth = usedFont.widthOfTextAtSize(testLine, size);
      if (testWidth > maxWidth && line !== '') {
        lines.push(line.trim());
        line = word + ' ';
      } else {
        line = testLine;
      }
    }
    lines.push(line.trim());

    for (const l of lines) {
      if (y < 72) {
        page = pdfDoc.addPage([612, 792]);
        y = height - 72;
      }
      page.drawText(l, { x, y, size, font: usedFont, color });
      y -= lineHeight;
    }
  };

  // Header
  drawText(userInfo.full_name, { size: 14, bold: true });
  y -= 5;

  // Contact
  const contactParts = [userInfo.email, userInfo.phone_number, userInfo.address].filter(Boolean);
  const contactText = contactParts.join(' | ');
  drawText(contactText, { size: 10 });
  y -= 20;

  // Date
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  drawText(today, { size: 11 });
  y -= 20;

  // Salutation
  drawText(coverLetterContent.salutation || 'Dear Hiring Manager,', { size: 11 });
  y -= 10;

  // Body paragraphs
  const paragraphs = [
    coverLetterContent.opening,
    coverLetterContent.body,
    coverLetterContent.companyFit,
    coverLetterContent.closing
  ].filter(Boolean);

  for (const para of paragraphs) {
    drawText(para);
    y -= 10;
  }

  // Sign off
  y -= 10;
  drawText(coverLetterContent.signoff || 'Sincerely,', { size: 11 });
  y -= 5;
  drawText(userInfo.full_name, { size: 11 });

  const pdfBytes = await pdfDoc.save();
  // Store with full_name_Cover_Letter_UUID format
  const sanitizedName = sanitizeFilename(userInfo.full_name || 'User');
  const filename = `${sanitizedName}_Cover_Letter_${uuidv4()}.pdf`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(filepath, pdfBytes);

  return { filename, filepath };
}

module.exports = { generateDocx, generatePdf, generateCoverLetterDocx, generateCoverLetterPdf };
