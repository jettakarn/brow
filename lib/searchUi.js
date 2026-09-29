import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';

const SEARCH_HINT = 'address or search';
const CURSOR_BREATH_MS = 560;
const CURSOR_OP_MIN = 55;
const CURSOR_OP_MAX = 255;

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
        console.error('Brow search: failed to open URI:', e);
        return false;
    }
}

function rgba(r, g, b, a = 255) {
    return new Clutter.Color({ red: r, green: g, blue: b, alpha: a });
}

function stopCursorBreath(host) {
    host._searchCursorBreathing = false;
    const cursor = host._searchCursor;
    if (cursor) {
        cursor.remove_all_transitions();
        cursor.opacity = 0;
        cursor.visible = false;
    }
}

function startCursorBreath(host) {
    const cursor = host._searchCursor;
    if (!cursor)
        return;

    cursor.visible = true;
    if (host._searchCursorBreathing)
        return;

    host._searchCursorBreathing = true;
    cursor.remove_all_transitions();
    cursor.opacity = CURSOR_OP_MAX;

    const pulse = () => {
        if (!host._searchCursorBreathing || !host._searchCursor)
            return;
        if (!(host._searchText?.get_text() || '').length) {
            stopCursorBreath(host);
            return;
        }
        cursor.ease({
            opacity: CURSOR_OP_MIN,
            duration: CURSOR_BREATH_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => {
                if (!host._searchCursorBreathing || !host._searchCursor)
                    return;
                cursor.ease({
                    opacity: CURSOR_OP_MAX,
                    duration: CURSOR_BREATH_MS,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onComplete: pulse,
                });
            },
        });
    };
    pulse();
}

/** Keep hint + text pinned to top-left (FixedLayout does not auto-center). */
function pinSearchTopLeft(host) {
    const hint = host._searchHint;
    const text = host._searchText;
    if (hint)
        hint.set_position(0, 0);
    if (text)
        text.set_position(0, 0);
}

/** Place breath cursor flush after the caret glyph. */
function layoutSearchCursor(host) {
    const text = host._searchText;
    const cursor = host._searchCursor;
    if (!text || !cursor)
        return;

    pinSearchTopLeft(host);

    const content = text.get_text() || '';
    if (!content.length) {
        cursor.visible = false;
        return;
    }

    let caretX = 0;
    let caretY = 0;
    let lineH = 18;
    let gotCoords = false;

    try {
        let pos = text.cursor_position;
        if (pos < 0 || pos > content.length)
            pos = content.length;
        const coords = text.position_to_coords(pos);
        if (Array.isArray(coords)) {
            if (coords.length >= 4 && typeof coords[0] === 'boolean') {
                if (coords[0]) {
                    caretX = coords[1];
                    caretY = coords[2];
                    lineH = coords[3] || 18;
                    gotCoords = true;
                }
            } else if (coords.length >= 3) {
                caretX = coords[0];
                caretY = coords[1];
                lineH = coords[2] || 18;
                gotCoords = true;
            }
        }
    } catch (e) {
        gotCoords = false;
    }

    if (!gotCoords) {
        try {
            const [, tw] = text.get_preferred_width(-1);
            caretX = tw;
        } catch (e) {
            caretX = 0;
        }
    }

    const x = Math.round(text.x + caretX);
    const y = Math.round(text.y + caretY);
    cursor.set_position(x, y);
    cursor.height = Math.max(14, Math.round(lineH));
    cursor.visible = true;
}

function syncSearchChrome(host) {
    const text = host._searchText;
    const hint = host._searchHint;
    if (!text || !hint)
        return;

    const empty = !(text.get_text() || '').length;
    hint.visible = empty;
    pinSearchTopLeft(host);

    if (empty) {
        stopCursorBreath(host);
        return;
    }

    layoutSearchCursor(host);
    startCursorBreath(host);
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        layoutSearchCursor(host);
        return GLib.SOURCE_REMOVE;
    });
}

export function buildSearchTab(host) {
    const tab = new St.BoxLayout({
        style_class: 'brow-search-tab',
        vertical: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.START,
        opacity: 0,
        translation_x: 50,
        reactive: false,
    });

    // FixedLayout: BinLayout was recentering Clutter.Text (logs: textX 0 → ~160).
    const field = new St.Widget({
        style_class: 'brow-search-field',
        layout_manager: new Clutter.FixedLayout(),
        x_expand: true,
        y_expand: true,
        reactive: true,
    });

    const hint = new St.Label({
        text: SEARCH_HINT,
        style_class: 'brow-search-hint',
    });

    const text = new Clutter.Text({
        reactive: false,
        editable: true,
        selectable: true,
        single_line_mode: true,
        activatable: true,
        cursor_visible: false,
        ellipsize: Pango.EllipsizeMode.NONE,
        color: rgba(255, 255, 255),
        cursor_color: rgba(255, 255, 255, 0),
        selection_color: rgba(255, 255, 255, 72),
        font_name: 'Inter SemiBold 18px',
        text: '',
    });
    try {
        text.set_cursor_size?.(0);
    } catch (e) {
        // ignore
    }

    const cursor = new St.Widget({
        style_class: 'brow-search-cursor',
        width: 2,
        height: 18,
        opacity: 0,
        visible: false,
    });

    text.connect('text-changed', () => syncSearchChrome(host));
    text.connect('cursor-changed', () => layoutSearchCursor(host));
    text.connect('activate', () => submitSearch(host));

    field.add_child(hint);
    field.add_child(text);
    field.add_child(cursor);
    pinSearchTopLeft(host);

    field.connect('notify::allocation', () => {
        pinSearchTopLeft(host);
        layoutSearchCursor(host);
    });

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
    host._searchCursor = cursor;
    host._searchCursorBreathing = false;

    syncSearchChrome(host);
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
    syncSearchChrome(host);
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
