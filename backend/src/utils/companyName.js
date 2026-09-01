function trimCompanyName(name) {
  return typeof name === 'string' ? name.trim() : name;
}

function prettyCompanyName(name) {
  const trimmed = trimCompanyName(name);
  if (!trimmed || typeof trimmed !== 'string') return trimmed || '';

  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) {
    return trimmed;
  }

  return trimmed.replace(/\S+/g, (word) => {
    if (word.length <= 4 && word === word.toUpperCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

module.exports = { trimCompanyName, prettyCompanyName };
