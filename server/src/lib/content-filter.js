const db = require('../db');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceSensitiveWords(value) {
  if (typeof value !== 'string' || !value) return value;
  let result = value;
  const rules = db.prepare(`
    SELECT word, COALESCE(NULLIF(replacement, ''), '***') AS replacement
    FROM filter_words
    WHERE word IS NOT NULL AND word != ''
    ORDER BY length(word) DESC
  `).all();
  for (const rule of rules) {
    result = result.replace(new RegExp(escapeRegExp(rule.word), 'gi'), () => rule.replacement);
  }
  return result;
}

module.exports = { replaceSensitiveWords };
