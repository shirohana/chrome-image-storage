export interface TagRule {
  id: string;
  name: string;
  pattern: string;
  isRegex: boolean;
  tags: string[];
  enabled: boolean;
}

const STORAGE_KEY = 'tagRules';

export async function loadTagRules(): Promise<TagRule[]> {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  return result[STORAGE_KEY] || [];
}

export async function saveTagRules(rules: TagRule[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: rules });
}

export async function addTagRule(rule: Omit<TagRule, 'id'>): Promise<string> {
  const rules = await loadTagRules();
  const newRule: TagRule = {
    ...rule,
    id: crypto.randomUUID(),
  };
  rules.push(newRule);
  await saveTagRules(rules);
  return newRule.id;
}

export async function updateTagRule(id: string, updates: Partial<Omit<TagRule, 'id'>>): Promise<void> {
  const rules = await loadTagRules();
  const index = rules.findIndex(r => r.id === id);
  if (index !== -1) {
    rules[index] = { ...rules[index], ...updates };
    await saveTagRules(rules);
  }
}

export async function deleteTagRule(id: string): Promise<void> {
  const rules = await loadTagRules();
  const filtered = rules.filter(r => r.id !== id);
  await saveTagRules(filtered);
}

export function matchesRule(pageTitle: string, rule: TagRule): boolean {
  if (!rule.enabled) return false;
  if (!pageTitle) pageTitle = '';

  if (rule.pattern === '') {
    return true;
  }

  if (rule.isRegex) {
    try {
      const regex = new RegExp(rule.pattern, 'i');
      return regex.test(pageTitle);
    } catch (e) {
      console.error('Invalid regex in rule:', rule.name, rule.pattern);
      return false;
    }
  }

  return pageTitle.toLowerCase().includes(rule.pattern.toLowerCase());
}

export function getAutoTags(pageTitle: string, rules: TagRule[]): string[] {
  const tags = new Set<string>();

  for (const rule of rules) {
    if (matchesRule(pageTitle, rule)) {
      rule.tags.forEach(tag => tags.add(tag));
    }
  }

  return Array.from(tags);
}

export function exportRulesToJSON(rules: TagRule[]): string {
  return JSON.stringify(rules, null, 2);
}

export interface ImportResult {
  imported: TagRule[];
  skipped: number;
}

function getRuleFingerprint(rule: Omit<TagRule, 'id' | 'enabled'>): string {
  return JSON.stringify({
    name: rule.name,
    pattern: rule.pattern,
    isRegex: rule.isRegex,
    tags: [...rule.tags].sort(),
  });
}

export async function importRulesFromJSON(jsonString: string): Promise<ImportResult> {
  const importedRules = JSON.parse(jsonString) as TagRule[];
  const existingRules = await loadTagRules();

  const existingFingerprints = new Set(
    existingRules.map(rule => getRuleFingerprint(rule))
  );

  const newRules: TagRule[] = [];
  let skippedCount = 0;

  for (const rule of importedRules) {
    const fingerprint = getRuleFingerprint(rule);
    if (existingFingerprints.has(fingerprint)) {
      skippedCount++;
    } else {
      const newRule: TagRule = {
        ...rule,
        id: crypto.randomUUID(),
        enabled: true,
      };
      newRules.push(newRule);
      existingFingerprints.add(fingerprint);
    }
  }

  if (newRules.length > 0) {
    const allRules = [...existingRules, ...newRules];
    await saveTagRules(allRules);
  }

  return {
    imported: newRules,
    skipped: skippedCount,
  };
}
