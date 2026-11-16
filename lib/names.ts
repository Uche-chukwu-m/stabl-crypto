// Owner name on the bank account must match the profile name before the vault
// opens. Tolerant of case, middle names, and punctuation.
export function namesMatch(legalName: string, ownerNames: string[]): boolean {
  const tokens = (s: string) => s.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean);
  const want = tokens(legalName);
  if (want.length === 0) return false;
  const first = want[0];
  const last = want[want.length - 1];
  return ownerNames.some((owner) => {
    const have = new Set(tokens(owner));
    return have.has(first) && have.has(last);
  });
}
