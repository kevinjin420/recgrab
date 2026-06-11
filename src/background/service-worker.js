// Background service worker: seed storage on install and reflect armed
// auto-grab state on the toolbar badge.

chrome.runtime.onInstalled.addListener(async () => {
	const cur = await chrome.storage.sync.get(['configs', 'enabled', 'armed']);
	const seed = {};
	if (!cur.configs) seed.configs = {};
	if (cur.enabled === undefined) seed.enabled = true;
	if (cur.armed === undefined) seed.armed = false;
	if (Object.keys(seed).length) await chrome.storage.sync.set(seed);
});

// Badge shows ARMED (red) when the global armed flag is on and the extension is
// enabled; otherwise blank.
async function refreshBadge() {
	const { enabled, armed } = await chrome.storage.sync.get(['enabled', 'armed']);
	const on = enabled !== false && !!armed;
	await chrome.action.setBadgeText({ text: on ? 'ARM' : '' });
	await chrome.action.setBadgeBackgroundColor({ color: '#b84a4a' });
}

chrome.storage.onChanged.addListener((changes, area) => {
	if (area === 'sync' && (changes.enabled || changes.armed)) refreshBadge();
});
chrome.runtime.onStartup?.addListener(refreshBadge);
refreshBadge();

chrome.runtime.onMessage.addListener((msg, sender) => {
	if (msg?.type === 'rg-notify') {
		chrome.action.setBadgeText({ text: '✓', tabId: sender.tab?.id });
		setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: sender.tab?.id }), 4000);
	}
});
