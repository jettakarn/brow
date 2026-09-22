import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';

const SEARCH_HINT = 'address or search';

/**
 * Turn free-form input into a URI for the default browser.
 * http(s) → as-is; host-like → https://…; else Google search.
 */
export function inputToUri(raw) {
    const text = (raw || '').trim();
    if (!text)
        return null;

    if (/^https?:\/\//i.test(text))
        return text;

    // Host-like: example.com, localhost:8080, 192.168.1.1 — no spaces.
    if (!/\s/.test(text) && (
        /^localhost(:\d+)?(\/.*)?$/i.test(text) ||
        /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(text) ||
        /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?(\/.*)?$/i.test(text)
    ))
        return `https://${text}`;

    const q = GLib.uri_escape_string(text, null, true);
    return `https://www.google.com/search?q=${q}`;
}

function launchUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, null);
        return true;
    } catch (e) {
        console.error('Islet search: failed to open URI:', e);
        return false;
    }
}

function rgba(r, g, b, a = 255) {
    return new Clutter.Color({ red: r, green: g, blue: b, alpha: a });
}

function syncHintVisibility(host) {
    const text = host._searchText;
    const hint = host._searchHint;
    if (!text || !hint)
        return;
    const empty = !(text.get_text() || '').length;
    hint.visible = empty;
}

export function buildSearchTab(host) {
    const tab = new St.BoxLayout({
        style_class: 'islet-search-tab',
        vertical: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.START,
        opacity: 0,
        translation_x: 50,
        reactive: false,
    });

    // Hint + editable Clutter.Text — no St.Entry input bar chrome.
    const field = new St.Widget({
        style_class: 'islet-search-field',
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.START,
        reactive: true,
    });

    const hint = new St.Label({
        text: SEARCH_HINT,
        style_class: 'islet-search-hint',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.START,
    });

    const text = new Clutter.Text({
        reactive: false,
        editable: true,
        selectable: true,
        single_line_mode: true,
        activatable: true,
        ellipsize: Pango.EllipsizeMode.END,
        color: rgba(255, 255, 255),
        cursor_color: rgba(255, 255, 255),
        selection_color: rgba(255, 255, 255, 72),
        font_name: 'Inter SemiBold 18px',
        text: '',
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });

    text.connect('text-changed', () => syncHintVisibility(host));
    text.connect('activate', () => submitSearch(host));

    field.add_child(hint);
    field.add_child(text);
    field.connect('button-press-event', () => {
        if (host._isExpanded && host._currentTab === 2) {
            try {
                text.grab_key_focus();
            } catch (e) {
                // ignore
            }
        }
        return Clutter.EVENT_STOP;
    });

    tab.add_child(field);
    host._searchTab = tab;
    host._searchField = field;
    host._searchHint = hint;
    host._searchText = text;

    syncHintVisibility(host);
    return tab;
}

export function submitSearch(host) {
    const text = host._searchText;
    if (!text)
        return;

    const uri = inputToUri(text.get_text());
    if (!uri)
        return;

    launchUri(uri);
    clearSearch(host);
    host._collapseExpanded?.();
}

export function clearSearch(host) {
    const text = host._searchText;
    if (!text)
        return;
    text.set_text('');
    syncHintVisibility(host);
}

export function setSearchReactive(host, on) {
    const text = host._searchText;
    const field = host._searchField;
    if (!text || !field)
        return;

    text.reactive = !!on;
    field.reactive = !!on;

    if (on) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (host._isExpanded && host._currentTab === 2 && host._searchText) {
                try {
                    host._searchText.grab_key_focus();
                } catch (e) {
                    // ignore
                }
            }
            return GLib.SOURCE_REMOVE;
        });
        return;
    }

    clearSearch(host);
}
