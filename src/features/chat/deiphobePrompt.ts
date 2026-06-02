const AMICA_EXPRESSION_TAGS = new Set([
  "neutral",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "shy",
  "jealous",
  "bored",
  "serious",
  "suspicious",
  "victory",
  "sleep",
  "love",
]);

export function stripLeadingAmicaExpressionTag(text: string): string {
  const match = text.match(/^\s*\[([^\]]+)\]\s*/);
  if (!match) {
    return text;
  }

  const tag = match[1]?.trim().toLowerCase();
  if (!AMICA_EXPRESSION_TAGS.has(tag)) {
    return text;
  }

  return text.slice(match[0].length);
}
