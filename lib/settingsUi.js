import St from 'gi://St';
import Clutter from 'gi://Clutter';

function writeSetting(settings, key, value) {
    if (typeof value === 'boolean')
        settings.set_boolean(key, value);
    else if (typeof value === 'number')
        settings.set_int(key, value);
    else
        settings.set_string(key, value);
}

function buildSectionLabel(title) {
    return new St.Label({
        text: title,
        style_class: 'islet-settings-section',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
    });
}

export function buildSettingRow(host, title, options, key) {
    const row = new St.BoxLayout({
        style_class: 'islet-settings-row',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    row.add_child(new St.Label({
        text: title,
        style_class: 'islet-settings-label',
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    }));

    const segment = new St.BoxLayout({
        style_class: 'islet-settings-segment',
        y_align: Clutter.ActorAlign.CENTER,
    });

    if (!host._settingsButtons)
        host._settingsButtons = {};
    host._settingsButtons[key] = [];

    options.forEach(opt => {
        const btn = new St.Button({
            label: opt.label,
            style_class: 'islet-settings-chip',
            reactive: false,
            can_focus: false,
        });
        btn._isletValue = opt.value;
        btn.connect('clicked', () => {
            writeSetting(host._settings, key, opt.value);
        });
        host._settingsButtons[key].push(btn);
        segment.add_child(btn);
    });

    row.add_child(segment);
    return row;
}

/** Recursively enable/disable setting chips. */
export function setSettingsControlsReactive(host, on) {
    const inner = host._settingsInner;
    if (!inner)
        return;

    const walk = actor => {
        if (!actor)
            return;
        if (actor instanceof St.Button) {
            actor.reactive = !!on;
            actor.can_focus = !!on;
        }
        if (actor.get_children) {
            for (const c of actor.get_children())
                walk(c);
        }
    };
    walk(inner);
}

/** Scroll settings content. Returns true if the view actually moved. */
export function scrollSettingsBy(host, dy) {
    const scroll = host._settingsScroll;
    if (!scroll || !dy)
        return false;

    try {
        const adj = scroll.vscroll?.adjustment;
        if (!adj)
            return false;
        const page = adj.page_size || 0;
        const upper = adj.upper || 0;
        const max = Math.max(0, upper - page);
        const before = adj.value;
        // Pixel-ish steps (avoid huge jumps that leave scroll ghosts).
        const next = Math.max(0, Math.min(max, before - dy * 14));
        if (Math.abs(next - before) < 0.25)
            return false;
        adj.value = next;
        try {
            scroll.queue_redraw?.();
            host._settingsInner?.queue_redraw?.();
        } catch (e) {
            // ignore
        }
        return true;
    } catch (e) {
        return false;
    }
}

export function buildSettingsTab(host) {
    // Outer tab actor — used for tab swipe opacity/translation only.
    const tab = new St.Bin({
        style_class: 'islet-settings-tab',
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        opacity: 0,
        translation_x: 50,
        reactive: false,
        clip_to_allocation: true,
    });

    const scroll = new St.ScrollView({
        style_class: 'islet-settings-scroll',
        x_expand: true,
        y_expand: true,
        overlay_scrollbars: true,
        // Island gesture handler owns scrolling so vertical ≠ tab swipe.
        reactive: false,
        clip_to_allocation: true,
    });
    try {
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
    } catch (e) {
        // older shells
    }
    try {
        scroll.enable_mouse_scrolling = false;
    } catch (e) {
        // ignore
    }
    // Hide the drag/scrollbar chrome; scrolling stays gesture-driven.
    try {
        if (scroll.vscroll)
            scroll.vscroll.visible = false;
        if (scroll.hscroll)
            scroll.hscroll.visible = false;
    } catch (e) {
        // ignore
    }

    const inner = new St.BoxLayout({
        style_class: 'islet-settings-box',
        vertical: true,
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.START,
        // Do NOT clip_to_allocation here: ScrollView may allocate only the
        // viewport height; clipping would hide sections below (e.g. Experimental).
    });

    // Display
    inner.add_child(buildSectionLabel('Display'));
    inner.add_child(buildSettingRow(host, 'Temp', [
        { label: '°C', value: 'celsius' },
        { label: '°F', value: 'fahrenheit' },
    ], 'temperature-unit'));
    inner.add_child(buildSettingRow(host, 'Clock', [
        { label: '24h', value: '24h' },
        { label: '12h', value: '12h' },
    ], 'clock-format'));

    // HUD
    inner.add_child(buildSectionLabel('HUD'));
    inner.add_child(buildSettingRow(host, 'Volume', [
        { label: 'On', value: true },
        { label: 'Off', value: false },
    ], 'show-volume-hud'));
    inner.add_child(buildSettingRow(host, 'Battery', [
        { label: 'On', value: true },
        { label: 'Off', value: false },
    ], 'show-battery-banners'));
    inner.add_child(buildSettingRow(host, 'Low battery', [
        { label: '15%', value: 15 },
        { label: '20%', value: 20 },
        { label: '25%', value: 25 },
    ], 'low-battery-percent'));

    // Experimental
    inner.add_child(buildSectionLabel('Experimental'));
    inner.add_child(buildSettingRow(host, 'Fingerprint', [
        { label: 'On', value: true },
        { label: 'Off', value: false },
    ], 'fingerprint-island'));

    if (typeof scroll.set_child === 'function')
        scroll.set_child(inner);
    else
        scroll.add_child(inner);

    tab.set_child(scroll);

    host._settingsTab = tab;
    host._settingsScroll = scroll;
    host._settingsInner = inner;

    return tab;
}

export function syncSettingsUi(host) {
    if (!host._settingsButtons || !host._settings)
        return;

    const apply = (key, current) => {
        (host._settingsButtons[key] || []).forEach(btn => {
            if (btn._isletValue === current)
                btn.add_style_class_name('islet-settings-chip-active');
            else
                btn.remove_style_class_name('islet-settings-chip-active');
        });
    };

    apply('temperature-unit', host._settings.get_string('temperature-unit'));
    apply('clock-format', host._settings.get_string('clock-format'));
    apply('show-volume-hud', host._settings.get_boolean('show-volume-hud'));
    apply('show-battery-banners', host._settings.get_boolean('show-battery-banners'));
    apply('low-battery-percent', host._settings.get_int('low-battery-percent'));
    apply('fingerprint-island', host._settings.get_boolean('fingerprint-island'));
}
