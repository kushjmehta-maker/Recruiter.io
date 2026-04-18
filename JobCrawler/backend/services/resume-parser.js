const pdfParse = require('pdf-parse');
const logger = require('../utils/logger');

/**
 * Parse a PDF resume buffer into plain text.
 * @param {Buffer} buffer - PDF file buffer
 * @returns {string} extracted text
 */
async function parseResume(buffer) {
  try {
    const data = await pdfParse(buffer);
    const text = data.text?.trim() || '';
    if (!text) {
      throw new Error('No text could be extracted from the PDF');
    }
    logger.info(`[ResumeParser] Extracted ${text.length} chars from resume`);
    return text;
  } catch (err) {
    logger.error('[ResumeParser] Failed to parse PDF', { error: err.message });
    throw new Error(`Resume parsing failed: ${err.message}`);
  }
}

module.exports = { parseResume };
