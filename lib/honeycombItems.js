import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const DEFAULT_ITEMS = [
    { type: 'url', url: 'https://www.google.com' },
    { type: 'url', url: 'https://www.youtube.com' },
    { type: 'url', url: 'https://mail.google.com' },
    { type: 'url', url: 'https://maps.google.com' },
    { type: 'url', url: 'https://drive.google.com' },
    { type: 'url', url: 'https://github.com' },
    { type: 'url', url: 'https://www.wikipedia.org' },
    { type: 'url', url: 'https://www.reddit.com' },
    { type: 'url', url: 'https://x.com' },
    { type: 'url', url: 'https://www.instagram.com' },
    { type: 'url', url: 'https://www.facebook.com' },
    { type: 'url', url: 'https://www.netflix.com' },
    { type: 'url', url: 'https://open.spotify.com' },
    { type: 'url', url: 'https://discord.com' },
    { type: 'url', url: 'https://www.twitch.tv' },
    { type: 'url', url: 'https://www.amazon.com' },
    { type: 'url', url: 'https://chatgpt.com' },
    { type: 'url', url: 'https://www.notion.so' },
    { type: 'url', url: 'https://stackoverflow.com' },
    { type: 'url', url: 'https://www.linkedin.com' },
];

export function normalizeUrl(raw) {
    const text = (raw || '').trim();
    if (!text)
        return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(text))
        return text;
    return `https://${text}`;
}

export function cleanItem(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    if (raw.type === 'url')
        return { type: 'url', url: `${raw.url || ''}` };
    if (raw.type === 'app')
        return { type: 'app', app: `${raw.app || ''}`.trim() };
    return null;
}

export function readItems(settings) {
    let text = '';
    try {
        text = settings.get_string('honeycomb-items') || '';
    } catch (e) {
        text = '';
    }
    if (!text)
        return DEFAULT_ITEMS.map(item => ({ ...item }));
    try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed))
            return DEFAULT_ITEMS.map(item => ({ ...item }));
        return parsed.map(cleanItem).filter(Boolean);
    } catch (e) {
        return DEFAULT_ITEMS.map(item => ({ ...item }));
    }
}

export function writeItems(settings, items) {
    settings.set_string('honeycomb-items', JSON.stringify(items));
}

export function appName(id) {
    if (!id)
        return '';
    try {
        return Gio.DesktopAppInfo.new(id)?.get_name() || '';
    } catch (e) {
        return '';
    }
}

export function hostOf(uri) {
    try {
        return GLib.Uri.parse(uri, GLib.UriFlags.NONE).get_host() || uri;
    } catch (e) {
        return uri;
    }
}

export function itemTitle(item) {
    if (!item)
        return 'Dot';
    if (item.type === 'url')
        return hostOf(item.url) || item.url || 'Website';
    return appName(item.app) || item.app || 'Application';
}
