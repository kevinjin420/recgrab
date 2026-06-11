// Background service worker: seed storage on install and reflect armed
// auto-grab state on the toolbar badge.

chrome.runtime.onInstalled.addListener(async () => {
	const { configs } = await chrome.storage.sync.get('configs');
	if (!configs) await chrome.storage.sync.set({ configs: {} });
});

// Badge shows ON (red) if any saved page config has auto-grab armed.
async function refreshBadge() {
	const { configs } = await chrome.storage.sync.get('configs');
	const armed = Object.values(configs || {}).some((c) => c?.enabled && c?.autoGrab);
	await chrome.action.setBadgeText({ text: armed ? 'ON' : '' });
	await chrome.action.setBadgeBackgroundColor({ color: armed ? '#b84a4a' : '#466c04' });
}

chrome.storage.onChanged.addListener((changes, area) => {
	if (area === 'sync' && changes.configs) refreshBadge();
});
chrome.runtime.onStartup?.addListener(refreshBadge);
refreshBadge();

chrome.runtime.onMessage.addListener((msg, sender) => {
	if (msg?.type === 'rg-notify') {
		chrome.action.setBadgeText({ text: '✓', tabId: sender.tab?.id });
		setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: sender.tab?.id }), 4000);
	}
});
