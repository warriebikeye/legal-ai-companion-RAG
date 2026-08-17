// A trailing segment only counts as a "hash" (and gets stripped) if it's
// hex-only and contains both a letter and a digit — e.g. "7cef938a".
// Plain words ("revised", "edition") or years ("2003") don't match, since
// they're either non-hex letters or all-digit, so they're left alone.
const HASH_SEGMENT = /^(?=.*[a-f])(?=.*[0-9])[a-f0-9]{6,}$/i;

// Strips a trailing "-<hash>" before the extension, e.g.
// "workmen-s-compensation-act-1987-pndcl-187-revised-edition-7cef938a.pdf"
// -> "workmen-s-compensation-act-1987-pndcl-187-revised-edition.pdf"
// Leaves the name untouched if the last segment isn't hash-like.
export function stripTrailingHashSegment(fileName) {
  const match = fileName.match(/^(.*)-([^-]+)(\.[^.]+)$/);
  if (!match) return fileName;

  const [, base, lastSegment, ext] = match;
  return HASH_SEGMENT.test(lastSegment) ? `${base}${ext}` : fileName;
}
