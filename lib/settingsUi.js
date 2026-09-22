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

export function buildSettingsTab(host) {
    const tab = new St.BoxLayout({
        style_class: 'islet-settings-box',
        vertical: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
        opacity: 0,
        translation_x: 50,
        reactive: false,
    });

    tab.add_child(buildSettingRow(host, 'temp', [
        { label: '°c', value: 'celsius' },
        { label: '°f', value: 'fahrenheit' },
    ], 'temperature-unit'));

    tab.add_child(buildSettingRow(host, 'clock', [
        { label: '24h', value: '24h' },
        { label: '12h', value: '12h' },
    ], 'clock-format'));

    tab.add_child(buildSettingRow(host, 'volume', [
        { label: 'on', value: true },
        { label: 'off', value: false },
    ], 'show-volume-hud'));

    tab.add_child(buildSettingRow(host, 'battery', [
        { label: 'on', value: true },
        { label: 'off', value: false },
    ], 'show-battery-banners'));

    tab.add_child(buildSettingRow(host, 'low', [
        { label: '15', value: 15 },
        { label: '20', value: 20 },
        { label: '25', value: 25 },
    ], 'low-battery-percent'));

    tab.add_child(buildSettingRow(host, 'fprint', [
        { label: 'on', value: true },
        { label: 'off', value: false },
    ], 'fingerprint-island'));

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
