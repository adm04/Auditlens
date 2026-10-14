// Preferences in chrome.storage.local (device only).

export const DEFAULT_SETTINGS = {
  agencyName: '',
  auditorName: '',
  footerText: '',
  brandColor: '#FF6B3D',
  logoDataUrl: '',
  psiKey: '',          // optional Google PageSpeed Insights API key
  runMobile: true,     // capture the 390px mobile view by default
  runPSI: true,        // run PageSpeed Insights by default
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...settings } });
}
