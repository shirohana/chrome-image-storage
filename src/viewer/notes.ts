// Notes panel: a persistent free-text scratchpad saved to chrome.storage.
// Call initNotes() once on page load to wire up the panel (no import-time DOM access).

// Load notes from storage
async function loadNotes(): Promise<{ content: string; collapsed: boolean }> {
  const result = await chrome.storage.local.get(['notesContent', 'notesCollapsed']);
  return {
    content: result.notesContent ?? '',
    collapsed: result.notesCollapsed ?? false, // Default: expanded
  };
}

// Save notes content
async function saveNotesContent(content: string): Promise<void> {
  await chrome.storage.local.set({ notesContent: content });
}

// Save collapsed state
async function saveNotesCollapsed(collapsed: boolean): Promise<void> {
  await chrome.storage.local.set({ notesCollapsed: collapsed });
}

// Wire up the notes panel. Call once on page load.
export function initNotes(): void {
  const notesPanel = document.getElementById('notes-panel')!;
  const notesTextarea = document.getElementById('notes-textarea') as HTMLTextAreaElement;
  const notesToggle = document.getElementById('notes-toggle')!;

  // Initialize notes panel
  loadNotes().then(({ content, collapsed }) => {
    notesTextarea.value = content;
    if (collapsed) {
      notesPanel.classList.add('collapsed');
      notesToggle.textContent = '+';
    }
  });

  // Auto-save on input with debouncing
  let notesDebounceTimer: number | undefined;
  notesTextarea.addEventListener('input', () => {
    clearTimeout(notesDebounceTimer);
    notesDebounceTimer = window.setTimeout(() => {
      saveNotesContent(notesTextarea.value);
    }, 500); // 500ms debounce
  });

  // Toggle collapse/expand
  notesToggle.addEventListener('click', () => {
    const isCollapsed = notesPanel.classList.toggle('collapsed');
    notesToggle.textContent = isCollapsed ? '+' : '−';
    saveNotesCollapsed(isCollapsed);
  });
}
