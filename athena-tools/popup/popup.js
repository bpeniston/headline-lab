// popup/popup.js
const DEFAULTS = {
  uiTweaks:      true,
  headlineLab:   true,
  trendingTopics: true,
  autoApply:     false,
  applyTime:     '02:00',
};

const toggles = {
  uiTweaks:       document.getElementById('toggle-uiTweaks'),
  headlineLab:    document.getElementById('toggle-headlineLab'),
  trendingTopics: document.getElementById('toggle-trendingTopics'),
  autoApply:      document.getElementById('toggle-autoApply'),
};

const timeInput     = document.getElementById('apply-time');
const lastRunEl     = document.getElementById('last-run-status');

// ── Load saved settings ───────────────────────────────────────
chrome.storage.sync.get(DEFAULTS, (flags) => {
  Object.entries(toggles).forEach(([key, el]) => { el.checked = flags[key]; });
  timeInput.value    = flags.applyTime;
  timeInput.disabled = !flags.autoApply;
});

// ── Save on change ────────────────────────────────────────────
Object.entries(toggles).forEach(([key, el]) => {
  el.addEventListener('change', () => {
    chrome.storage.sync.set({ [key]: el.checked });
    if (key === 'autoApply') timeInput.disabled = !el.checked;
  });
});

timeInput.addEventListener('change', () => {
  chrome.storage.sync.set({ applyTime: timeInput.value });
});

// ── Last-run status ───────────────────────────────────────────
chrome.storage.local.get(['lastAutoRun', 'lastRunSummary', 'lastRunError', 'undoTimestamp'], (data) => {
  if (!data.lastAutoRun) return;

  const when    = formatRelative(data.lastAutoRun);
  const undoStillAvailable = data.undoTimestamp && (Date.now() - data.undoTimestamp < 8 * 60 * 60 * 1000);

  if (data.lastRunError) {
    lastRunEl.textContent = `Last run ${when}: failed`;
    lastRunEl.classList.add('error');
  } else if (data.lastRunSummary?.length) {
    const topics  = data.lastRunSummary.slice(0, 3).join(', ');
    const more    = data.lastRunSummary.length > 3 ? ` +${data.lastRunSummary.length - 3}` : '';
    const undoHint = undoStillAvailable ? ' · undo available' : '';
    lastRunEl.textContent = `Last run ${when}: ${topics}${more}${undoHint}`;
  }
});

// ── Helpers ───────────────────────────────────────────────────
function formatRelative(ts) {
  const diffMs  = Date.now() - ts;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 2)   return 'just now';
  if (diffMin < 60)  return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24)   return `${diffHr}h ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
