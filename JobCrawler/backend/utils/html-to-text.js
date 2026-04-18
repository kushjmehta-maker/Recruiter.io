const { convert } = require('html-to-text');

const htmlToText = (html) => {
  if (!html) return '';
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  });
};

module.exports = { htmlToText };
