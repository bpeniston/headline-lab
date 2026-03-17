// popup/popup.js
const DEFAULTS = { uiTweaks: true, headlineLab: true };

const toggles = {
  uiTweaks:    document.getElementById('toggle-uiTweaks'),
  headlineLab: document.getElementById('toggle-headlineLab'),
};

// Load saved state
chrome.storage.sync.get(DEFAULTS, (flags) => {
  Object.entries(toggles).forEach(([key, el]) => {
    el.checked = flags[key];
  });
});

// Save on change
Object.entries(toggles).forEach(([key, el]) => {
  el.addEventListener('change', () => {
    chrome.storage.sync.set({ [key]: el.checked });
  });
});
