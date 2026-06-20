import { showToast } from './toast';

// Tag Rules Management
import {
  loadTagRules,
  addTagRule,
  updateTagRule,
  deleteTagRule,
  exportRulesToJSON,
  importRulesFromJSON,
  type TagRule,
  type ImportResult
} from '../storage/tag-rules';

// DOM refs assigned by initTagRules() (no import-time DOM access).
let tagRulesList: HTMLElement;
let ruleNameInput: HTMLInputElement;
let rulePatternInput: HTMLInputElement;
let ruleRegexToggle: HTMLInputElement;
let ruleTagsInput: HTMLInputElement;
let addRuleBtn: HTMLElement;
let cancelRuleBtn: HTMLElement;
let exportRulesBtn: HTMLElement;
let importRulesBtn: HTMLElement;
let importRulesInput: HTMLInputElement;

let editingRuleId: string | null = null;
export let newlyImportedRuleIds = new Set<string>();

export async function renderTagRules() {
  const rules = await loadTagRules();

  if (rules.length === 0) {
    tagRulesList.innerHTML = '<p class="no-rules-message">No auto-tagging rules configured yet.</p>';
    return;
  }

  rules.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  tagRulesList.innerHTML = rules.map(rule => `
    <div class="tag-rule-card ${!rule.enabled ? 'disabled' : ''} ${newlyImportedRuleIds.has(rule.id) ? 'newly-imported' : ''}" data-rule-id="${rule.id}">
      <div class="tag-rule-header">
        <div class="tag-rule-info">
          <strong>
            ${escapeHtml(rule.name)}
            ${newlyImportedRuleIds.has(rule.id) ? '<span class="new-badge">NEW</span>' : ''}
          </strong>
          <span class="tag-rule-pattern">
            ${rule.pattern === '' ? '(matches all)' : escapeHtml(rule.pattern)}
            ${rule.isRegex ? '<span class="regex-badge">regex</span>' : ''}
          </span>
        </div>
        <div class="tag-rule-actions">
          <label class="toggle-switch">
            <input type="checkbox" class="rule-enabled-toggle" ${rule.enabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <button class="icon-button edit-rule-btn" title="Edit rule">✎</button>
          <button class="icon-button delete-rule-btn" title="Delete rule">×</button>
        </div>
      </div>
      <div class="tag-rule-tags">
        ${rule.tags.map(tag => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join('')}
      </div>
    </div>
  `).join('');

  attachRuleEventListeners();
}

function attachRuleEventListeners() {
  const ruleCards = tagRulesList.querySelectorAll('.tag-rule-card');

  ruleCards.forEach(card => {
    const ruleId = card.getAttribute('data-rule-id')!;

    const enableToggle = card.querySelector('.rule-enabled-toggle') as HTMLInputElement;
    enableToggle.addEventListener('change', async () => {
      await updateTagRule(ruleId, { enabled: enableToggle.checked });
      await renderTagRules();
    });

    const editBtn = card.querySelector('.edit-rule-btn');
    editBtn?.addEventListener('click', async () => {
      const rules = await loadTagRules();
      const rule = rules.find(r => r.id === ruleId);
      if (rule) {
        editingRuleId = ruleId;
        ruleNameInput.value = rule.name;
        rulePatternInput.value = rule.pattern;
        ruleRegexToggle.checked = rule.isRegex;
        ruleTagsInput.value = rule.tags.join(' ');
        addRuleBtn.textContent = 'Update Rule';
        cancelRuleBtn.style.display = 'inline-block';
        ruleNameInput.focus();
      }
    });

    const deleteBtn = card.querySelector('.delete-rule-btn');
    deleteBtn?.addEventListener('click', async () => {
      if (confirm('Delete this rule?')) {
        await deleteTagRule(ruleId);
        await renderTagRules();
      }
    });
  });
}

// Look up DOM refs and wire up the tag-rules UI. Call once on page load
// before renderTagRules().
export function initTagRules(): void {
  tagRulesList = document.getElementById('tag-rules-list')!;
  ruleNameInput = document.getElementById('rule-name-input') as HTMLInputElement;
  rulePatternInput = document.getElementById('rule-pattern-input') as HTMLInputElement;
  ruleRegexToggle = document.getElementById('rule-regex-toggle') as HTMLInputElement;
  ruleTagsInput = document.getElementById('rule-tags-input') as HTMLInputElement;
  addRuleBtn = document.getElementById('add-rule-btn')!;
  cancelRuleBtn = document.getElementById('cancel-rule-btn')!;
  exportRulesBtn = document.getElementById('export-rules-btn')!;
  importRulesBtn = document.getElementById('import-rules-btn')!;
  importRulesInput = document.getElementById('import-rules-input') as HTMLInputElement;

  addRuleBtn.addEventListener('click', async () => {
  const name = ruleNameInput.value.trim();
  const pattern = rulePatternInput.value.trim();
  const isRegex = ruleRegexToggle.checked;
  const tagsText = ruleTagsInput.value.trim();

  if (!name) {
    alert('Please enter a rule name');
    return;
  }

  const tags = tagsText ? tagsText.split(/\s+/).filter(t => t) : [];

  if (tags.length === 0) {
    alert('Please enter at least one tag');
    return;
  }

  if (editingRuleId) {
    await updateTagRule(editingRuleId, { name, pattern, isRegex, tags });
    editingRuleId = null;
    addRuleBtn.textContent = 'Add Rule';
    cancelRuleBtn.style.display = 'none';
  } else {
    await addTagRule({ name, pattern, isRegex, tags, enabled: true });
  }

  ruleNameInput.value = '';
  rulePatternInput.value = '';
  ruleRegexToggle.checked = false;
  ruleTagsInput.value = '';

  await renderTagRules();
});

cancelRuleBtn.addEventListener('click', () => {
  editingRuleId = null;
  ruleNameInput.value = '';
  rulePatternInput.value = '';
  ruleRegexToggle.checked = false;
  ruleTagsInput.value = '';
  addRuleBtn.textContent = 'Add Rule';
  cancelRuleBtn.style.display = 'none';
});

exportRulesBtn.addEventListener('click', async () => {
  const rules = await loadTagRules();
  const jsonString = exportRulesToJSON(rules);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '-' + Date.now();
  const filename = `auto-tagging-rules-${timestamp}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

importRulesBtn.addEventListener('click', () => {
  importRulesInput.click();
});

importRulesInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const result: ImportResult = await importRulesFromJSON(text);

    newlyImportedRuleIds = new Set(result.imported.map(r => r.id));
    await renderTagRules();

    const message = result.imported.length > 0
      ? `Imported ${result.imported.length} new rule${result.imported.length > 1 ? 's' : ''}${result.skipped > 0 ? `, skipped ${result.skipped} duplicate${result.skipped > 1 ? 's' : ''}` : ''}`
      : `No new rules imported (${result.skipped} duplicate${result.skipped > 1 ? 's' : ''} skipped)`;

    alert(message);
  } catch (error) {
    console.error('Import failed:', error);
    alert('Failed to import rules. Please check the file format.');
  }

  importRulesInput.value = '';
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
