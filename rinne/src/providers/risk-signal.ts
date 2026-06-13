// Shared definition of what counts as a high-risk signal in provider evidence
// data. Nansen exposes risk as address *labels* (there is no numeric score in
// the public API), so the guard treats a label matching any of these danger
// words as high risk. Keeping this in one place means the Nansen adapter and
// the approval/lending rules cannot drift on what "high risk" means.

// Whole-word risk phrases, not bare substrings. Word boundaries plus specific
// forms keep benign labels from manufacturing a false block: "Critical
// Infrastructure DAO", "Hackathon Sponsor", "rugby", "drug", "Exploit
// Protection Service" must NOT match — only genuine risk terms do. The
// candidate is whitespace-normalized first so "high  risk" and "high_risk"
// both match.
const HIGH_RISK_LABEL_RE =
  /\b(high[\s_-]*risk|critical[\s_-]*risk|malicious|scam|scammer|exploiter|exploited|hacker|hacked|phishing|phisher|drainer|sanctioned|fraudster|rug[\s_-]*pull|blocklisted|blacklisted)\b/i;

// Returns the first matching high-risk label found in provider evidence data,
// or null. Looks at a `labels` array, a `categories` array, and a `riskLabel`
// string — whichever the adapter populated.
export function detectHighRiskLabel(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const candidates: string[] = [];
  if (typeof data["riskLabel"] === "string") candidates.push(data["riskLabel"]);
  if (Array.isArray(data["labels"])) {
    for (const label of data["labels"]) {
      if (typeof label === "string") candidates.push(label);
    }
  }
  if (Array.isArray(data["categories"])) {
    for (const category of data["categories"]) {
      if (typeof category === "string") candidates.push(category);
    }
  }
  for (const candidate of candidates) {
    if (HIGH_RISK_LABEL_RE.test(candidate.replace(/\s+/g, " ").trim())) {
      return candidate;
    }
  }
  return null;
}
