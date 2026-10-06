import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import GdkPixbuf from 'gi://GdkPixbuf';

import {
    hostOf,
    normalizeUrl,
    readItems,
} from './honeycombItems.js';

const ICON = 46;
const CELL = 54;
const DRAG_THRESHOLD = 10;
const INERTIA_MS = 16;

function state(host) {
    if (!host._shortcutsState) {
        host._shortcutsState = {
            viewport: null,
            dots: [],
            panX: 0,
            panY: 0,
            vx: 0,
            vy: 0,
            active: false,
            tracking: null,
            stageId: 0,
            inertiaId: 0,
        };
    }
    return host._shortcutsState;
}

function stopInertia(st) {
    if (st.inertiaId) {
        GLib.source_remove(st.inertiaId);
        st.inertiaId = 0;
    }
    st.vx = 0;
    st.vy = 0;
}

function centerHoneycomb(st) {
    stopInertia(st);
    endTrack(st);
    st.panX = 0;
    st.panY = 0;
    applyLayout(st);
}

function disconnectStage(st) {
    if (st.stageId) {
        try {
            global.stage.disconnect(st.stageId);
        } catch (e) {
            // ignore
        }
        st.stageId = 0;
    }
    st.tracking = null;
}

function collapseIsland(host) {
    host._isExpanded = false;
    host._currentTab = 0;
    host._setExpandedTabPickable(false);
    host._updateIslandView();
}

function layoutCells(count) {
    const span = Math.max(2, Math.ceil(Math.sqrt(count)) + 2);
    const cells = [];
    for (let row = -span; row <= span; row++) {
        const even = ((row % 2) + 2) % 2 === 0;
        for (let col = -span; col <= span; col++) {
            const x = (col + (even ? 0.5 : 0) - 0.5) * CELL;
            const y = row * CELL * Math.sqrt(3) / 2;
            cells.push({ x, y, d: Math.hypot(x, y) });
        }
    }
    cells.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    return cells.slice(0, count);
}

function contentRadius(st) {
    let max = 0;
    for (const dot of st.dots)
        max = Math.max(max, Math.hypot(dot._lx, dot._ly));
    return max;
}

function movePan(st, dx, dy, soft) {
    let nx = st.panX + dx;
    let ny = st.panY + dy;
    const maxR = contentRadius(st);
    const dist = Math.hypot(nx, ny);
    if (maxR <= 0) {
        st.panX = 0;
        st.panY = 0;
        return;
    }
    if (dist > maxR) {
        const limit = soft ? maxR + (dist - maxR) * 0.28 : maxR;
        const scale = limit / dist;
        nx *= scale;
        ny *= scale;
    }
    st.panX = nx;
    st.panY = ny;
}

function applyLayout(st) {
    const viewport = st.viewport;
    if (!viewport)
        return;
    const w = viewport.get_width();
    const h = viewport.get_height();
    if (!(w > 0) || !(h > 0))
        return;
    const sphereR = Math.max(80, Math.min(w, h) * 0.58);
    for (const dot of st.dots) {
        const dx = dot._lx + st.panX;
        const dy = dot._ly + st.panY;
        const dist = Math.hypot(dx, dy);
        const theta = Math.min(Math.PI / 2, dist / sphereR);
        const scale = Math.cos(theta);
        const proj = sphereR * Math.sin(theta);
        const ux = dist > 0.5 ? dx / dist : 0;
        const uy = dist > 0.5 ? dy / dist : 0;
        const sx = ux * proj;
        const sy = uy * proj;
        dot._hx = sx;
        dot._hy = sy;
        dot._hscale = scale;
        dot.translation_x = sx;
        dot.translation_y = sy;
        const shown = scale > 0.05;
        dot.visible = shown;
        if (!shown)
            continue;
        try {
            dot.set_pivot_point(0.5, 0.5);
        } catch (e) {
            // ignore
        }
        dot.scale_x = scale;
        dot.scale_y = scale;
        dot.opacity = Math.round(Math.max(0, Math.min(1, scale)) * 255);
        dot.reactive = st.active && scale > 0.34;
    }
}

function hitDot(st, x, y) {
    const viewport = st.viewport;
    if (!viewport)
        return null;
    const [vx, vy] = viewport.get_transformed_position();
    const lx = x - vx - viewport.get_width() / 2;
    const ly = y - vy - viewport.get_height() / 2;
    let best = null;
    let bestD = Infinity;
    for (const dot of st.dots) {
        if (!(dot._hscale > 0.34) || !dot.visible)
            continue;
        const d = Math.hypot(lx - dot._hx, ly - dot._hy);
        const r = (ICON * dot._hscale) / 2;
        if (d <= r && d < bestD) {
            best = dot;
            bestD = d;
        }
    }
    return best;
}

function launchDot(host, dot) {
    const item = dot?._item;
    if (!item)
        return;
    try {
        if (item.type === 'url') {
            const uri = normalizeUrl(item.url);
            if (uri)
                Gio.AppInfo.launch_default_for_uri(uri, null);
        } else if (item.app) {
            Gio.DesktopAppInfo.new(item.app)?.launch([], null);
        }
    } catch (e) {
        console.error(`Failed to open honeycomb dot: ${e}`);
    }
    collapseIsland(host);
}

function springStep(st) {
    const maxR = contentRadius(st);
    const dist = Math.hypot(st.panX, st.panY);
    if (maxR <= 0) {
        st.panX = 0;
        st.panY = 0;
        st.vx = 0;
        st.vy = 0;
        return false;
    }
    if (!(dist > maxR))
        return false;
    if (dist - maxR < 0.8) {
        const snap = maxR / dist;
        st.panX *= snap;
        st.panY *= snap;
        st.vx = 0;
        st.vy = 0;
        return false;
    }
    const scale = maxR / dist;
    st.panX += (st.panX * scale - st.panX) * 0.22;
    st.panY += (st.panY * scale - st.panY) * 0.22;
    st.vx *= 0.55;
    st.vy *= 0.55;
    return true;
}

function startInertia(host, st) {
    stopInertia(st);
    st.inertiaId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, INERTIA_MS, () => {
        if (!host._island || !st.active) {
            st.inertiaId = 0;
            return GLib.SOURCE_REMOVE;
        }
        st.panX += st.vx;
        st.panY += st.vy;
        st.vx *= 0.9;
        st.vy *= 0.9;
        const pulled = springStep(st);
        applyLayout(st);
        if (Math.hypot(st.vx, st.vy) < 0.35 && !pulled) {
            st.inertiaId = 0;
            st.vx = 0;
            st.vy = 0;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
}

function endTrack(st) {
    disconnectStage(st);
}

function beginTrack(host, st, event) {
    stopInertia(st);
    disconnectStage(st);
    const [x, y] = event.get_coords();
    const now = GLib.get_monotonic_time();
    st.tracking = {
        lastX: x,
        lastY: y,
        originX: x,
        originY: y,
        moved: false,
        samples: [{ t: now, x, y }],
    };
    st.stageId = global.stage.connect('captured-event', (_stage, ev) => {
        if (!st.tracking)
            return Clutter.EVENT_PROPAGATE;
        const type = ev.type();
        if (type === Clutter.EventType.MOTION) {
            const [mx, my] = ev.get_coords();
            const track = st.tracking;
            const dx = mx - track.lastX;
            const dy = my - track.lastY;
            track.lastX = mx;
            track.lastY = my;
            if (!track.moved && Math.hypot(mx - track.originX, my - track.originY) >= DRAG_THRESHOLD)
                track.moved = true;
            if (track.moved)
                movePan(st, dx, dy, true);
            const t = GLib.get_monotonic_time();
            track.samples.push({ t, x: mx, y: my });
            while (track.samples.length > 1 && t - track.samples[0].t > 90000)
                track.samples.shift();
            applyLayout(st);
            return track.moved ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE) {
            const track = st.tracking;
            const [rx, ry] = ev.get_coords();
            const moved = track.moved;
            let vx = 0;
            let vy = 0;
            const samples = track.samples;
            if (moved && samples.length >= 2) {
                const a = samples[0];
                const b = samples[samples.length - 1];
                const dt = (b.t - a.t) / 1000;
                if (dt > 0) {
                    vx = ((b.x - a.x) / dt) * INERTIA_MS;
                    vy = ((b.y - a.y) / dt) * INERTIA_MS;
                }
            }
            endTrack(st);
            if (moved) {
                st.vx = vx;
                st.vy = vy;
                startInertia(host, st);
                return Clutter.EVENT_STOP;
            }
            const dot = hitDot(st, rx, ry);
            if (dot) {
                launchDot(host, dot);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_PROPAGATE;
    });
}

const FAVICON_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function pixbufFromBytes(data) {
    if (!data || data.length < 16)
        return null;
    const loader = new GdkPixbuf.PixbufLoader();
    try {
        loader.write(data);
        loader.close();
        return loader.get_pixbuf();
    } catch (e) {
        try {
            loader.close();
        } catch (e2) {
            // ignore
        }
        return null;
    }
}

function loadCachedPng(file) {
    if (!file.query_exists(null))
        return false;
    try {
        GdkPixbuf.Pixbuf.new_from_file(file.get_path());
        return true;
    } catch (e) {
        try {
            file.delete(null);
        } catch (e2) {
            // ignore
        }
        return false;
    }
}

function storePng(pixbuf, file) {
    pixbuf.savev(file.get_path(), 'png', [], []);
}

function fetchPixbuf(soup, url, done) {
    let msg = null;
    try {
        msg = Soup.Message.new('GET', url);
    } catch (e) {
        msg = null;
    }
    if (!msg || !soup) {
        done(null);
        return;
    }
    try {
        msg.request_headers.append('User-Agent', FAVICON_UA);
    } catch (e) {
        // ignore
    }
    soup.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session, res) => {
        try {
            const bytes = session.send_and_read_finish(res);
            if (msg.get_status() !== Soup.Status.OK) {
                done(null);
                return;
            }
            done(pixbufFromBytes(bytes?.get_data?.()));
        } catch (e) {
            done(null);
        }
    });
}

function setDotIcon(dot, iconWidget, item, soup) {
    if (item.type === 'url') {
        const uri = normalizeUrl(item.url);
        const site = uri ? hostOf(uri) : '';
        iconWidget.icon_name = 'web-browser-symbolic';
        if (!site)
            return;
        const safeHost = site.replace(/[^a-zA-Z0-9.-]/g, '_');
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'brow', 'favicons']);
        GLib.mkdir_with_parents(dir, 0o755);
        const png = Gio.File.new_for_path(GLib.build_filenamev([dir, `${safeHost}.png`]));
        const applyPng = () => {
            try {
                iconWidget.gicon = Gio.FileIcon.new(png);
                iconWidget.icon_name = null;
            } catch (e) {
                iconWidget.icon_name = 'web-browser-symbolic';
            }
        };
        if (loadCachedPng(png)) {
            applyPng();
            return;
        }
        const keep = pixbuf => {
            if (!pixbuf || !dot.get_parent())
                return false;
            try {
                storePng(pixbuf, png);
                applyPng();
                return true;
            } catch (e) {
                return false;
            }
        };
        fetchPixbuf(soup, `https://${site}/favicon.ico`, pixbuf => {
            if (keep(pixbuf))
                return;
            const domain = encodeURIComponent(site);
            fetchPixbuf(soup, `https://www.google.com/s2/favicons?domain=${domain}&sz=64`, fallback => {
                keep(fallback);
            });
        });
        return;
    }

    try {
        const gicon = item.app ? Gio.DesktopAppInfo.new(item.app)?.get_icon?.() : null;
        if (gicon) {
            iconWidget.gicon = gicon;
            return;
        }
    } catch (e) {
        // fall through
    }
    iconWidget.icon_name = 'application-x-executable-symbolic';
}

function clearDots(st) {
    for (const dot of st.dots) {
        try {
            st.viewport.remove_child(dot);
        } catch (e) {
            // ignore
        }
    }
    st.dots = [];
}

export function rebuildShortcuts(host) {
    const st = state(host);
    const tab = host._shortcutsTab;
    if (!tab || !st.viewport || !host._settings)
        return;

    stopInertia(st);
    endTrack(st);
    clearDots(st);

    const items = readItems(host._settings).filter(item => {
        if (item.type === 'url')
            return !!normalizeUrl(item.url);
        return !!item.app;
    });
    const cells = layoutCells(items.length);
    items.forEach((item, i) => {
        const dot = new St.Button({
            style_class: 'brow-hex-dot',
            width: ICON,
            height: ICON,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: false,
            can_focus: false,
        });
        const icon = new St.Icon({
            style_class: 'brow-hex-dot-icon',
            icon_size: ICON - 14,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        dot.set_child(icon);
        dot._item = item;
        dot._lx = cells[i].x;
        dot._ly = cells[i].y;
        try {
            dot.set_pivot_point(0.5, 0.5);
        } catch (e) {
            // ignore
        }
        st.viewport.add_child(dot);
        st.dots.push(dot);
        setDotIcon(dot, icon, item, host._soup);
    });
    applyLayout(st);
}

export function buildShortcutsTab(host) {
    const tab = new St.Widget({
        style_class: 'brow-hex-tab',
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
        opacity: 0,
        translation_x: 50,
        reactive: false,
    });
    const viewport = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
        reactive: false,
    });
    tab.add_child(viewport);
    host._shortcutsTab = tab;
    const st = state(host);
    st.viewport = viewport;

    viewport.connect('captured-event', (_actor, event) => {
        if (!st.active)
            return Clutter.EVENT_PROPAGATE;
        if (event.type() !== Clutter.EventType.BUTTON_PRESS)
            return Clutter.EVENT_PROPAGATE;
        if (event.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;
        beginTrack(host, st, event);
        return Clutter.EVENT_PROPAGATE;
    });

    const relayout = () => applyLayout(st);
    viewport.connect('notify::width', relayout);
    viewport.connect('notify::height', relayout);

    rebuildShortcuts(host);
    return tab;
}

export function setShortcutsReactive(host, on) {
    const st = state(host);
    const tab = host._shortcutsTab;
    if (!tab)
        return;
    st.active = !!on;
    tab.reactive = !!on;
    if (st.viewport)
        st.viewport.reactive = !!on;
    if (!on)
        centerHoneycomb(st);
    else
        applyLayout(st);
}

export function onShortcutsTabHidden(host) {
    centerHoneycomb(state(host));
}
