//
// Glance scan media, drawn inside Brow's peninsula.
// The still, success clip, and failure clip are the original Glance files:
// unlockstatic.png, unlockanimation.mp4, unsuccessfulunlockanimation.mp4.
//
// Adapted from Glance by Jonathan Zhou
// https://github.com/jonnyoo/glance
// Copyright (c) 2026 Jonathan Zhou
// SPDX-License-Identifier: MIT
//

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {
    HOWDY_OPEN_SIZE,
    HOWDY_MEDIA_INSET,
    HOWDY_BREATH_HALF_MS,
    HOWDY_BREATH_HOLD_MS,
    HOWDY_BREATH_START_MS,
    HOWDY_BREATH_SETTLE_MS,
    HOWDY_PULSE_SCALE,
    HOWDY_PULSE_OPACITY,
    HOWDY_FRAME_MS,
    HOWDY_PLAYBACK_RATE,
} from './constants.js';

function contentFromPixbuf(pixbuf) {
    let pix = pixbuf;
    if (!pixbuf.get_has_alpha() || pixbuf.get_n_channels() !== 4)
        pix = pixbuf.add_alpha(false, 0, 0, 0);

    const width = pix.get_width();
    const height = pix.get_height();
    const content = St.ImageContent.new_with_preferred_size(width, height);
    const copy = new Uint8Array(pix.get_pixels());
    content.set_bytes(
        GLib.Bytes.new(copy),
        Cogl.PixelFormat.RGBA_8888,
        width,
        height,
        pix.get_rowstride()
    );
    return content;
}

function contentFromPath(path) {
    return contentFromPixbuf(GdkPixbuf.Pixbuf.new_from_file(path));
}

function framePaths(dirPath) {
    const dir = Gio.File.new_for_path(dirPath);
    if (!dir.query_exists(null))
        return [];

    const names = [];
    const iter = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info = iter.next_file(null);
    while (info) {
        const name = info.get_name();
        if (name.endsWith('.png'))
            names.push(name);
        info = iter.next_file(null);
    }
    iter.close(null);
    names.sort();
    return names.map(name => GLib.build_filenamev([dirPath, name]));
}

/**
 * @param {string} mediaDir directory containing idle.png, success/, failure/
 */
export function buildHowdyUi(mediaDir) {
    const root = new St.Widget({
        style_class: 'brow-howdy-root',
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
        opacity: 0,
    });

    const mediaSize = HOWDY_OPEN_SIZE - HOWDY_MEDIA_INSET * 2;
    const media = new St.Widget({
        width: mediaSize,
        height: mediaSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    media.set_pivot_point(0.5, 0.5);
    media.set_content_gravity(Clutter.ContentGravity.RESIZE_ASPECT);
    root.add_child(media);

    let idleContent = null;
    let successFrames = null;
    let failureFrames = null;
    let framesReady = false;
    let breathing = false;
    let breathDimmed = false;
    let breathHoldId = 0;
    let breathStartId = 0;
    let frameSourceId = 0;
    let frameError = null;

    function _clearSource(id) {
        if (!id)
            return 0;
        GLib.source_remove(id);
        return 0;
    }

    function _ensureIdle() {
        if (idleContent || frameError)
            return;
        try {
            idleContent = contentFromPath(GLib.build_filenamev([mediaDir, 'idle.png']));
        } catch (e) {
            frameError = String(e?.message ?? e);
            console.error('Brow: howdy still failed to load:', frameError);
        }
    }

    function _ensureFrames() {
        if (framesReady)
            return;
        framesReady = true;
        _ensureIdle();
        if (frameError)
            return;
        try {
            successFrames = framePaths(GLib.build_filenamev([mediaDir, 'success'])).map(contentFromPath);
            failureFrames = framePaths(GLib.build_filenamev([mediaDir, 'failure'])).map(contentFromPath);
        } catch (e) {
            console.error('Brow: howdy frames failed to load:', e.message ?? e);
            successFrames = [];
            failureFrames = [];
            frameError = String(e?.message ?? e);
        }
    }

    function _showContent(content) {
        if (!content)
            return;
        try {
            media.set_content(content);
        } catch (e) {
            // ignore
        }
    }

    function _stopFrames() {
        frameSourceId = _clearSource(frameSourceId);
    }

    function _stopBreath(settle) {
        breathing = false;
        breathHoldId = _clearSource(breathHoldId);
        breathStartId = _clearSource(breathStartId);
        try {
            media.remove_all_transitions();
        } catch (e) {
            // ignore
        }
        const dimmed = media.opacity < 250 || media.scale_x < 0.995;
        if (settle && dimmed) {
            try {
                media.ease({
                    opacity: 255,
                    scale_x: 1,
                    scale_y: 1,
                    duration: HOWDY_BREATH_SETTLE_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                return;
            } catch (e) {
                // fall through
            }
        }
        media.opacity = 255;
        try {
            media.set_scale(1, 1);
        } catch (e) {
            media.scale_x = 1;
            media.scale_y = 1;
        }
    }

    function _breathHalf() {
        if (!breathing)
            return;
        breathDimmed = !breathDimmed;
        const opacity = breathDimmed ? HOWDY_PULSE_OPACITY : 255;
        const scale = breathDimmed ? HOWDY_PULSE_SCALE : 1;
        try {
            media.ease({
                opacity,
                scale_x: scale,
                scale_y: scale,
                duration: HOWDY_BREATH_HALF_MS,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                onComplete: () => {
                    if (!breathing)
                        return;
                    breathHoldId = GLib.timeout_add(
                        GLib.PRIORITY_DEFAULT,
                        HOWDY_BREATH_HOLD_MS,
                        () => {
                            breathHoldId = 0;
                            _breathHalf();
                            return GLib.SOURCE_REMOVE;
                        }
                    );
                },
            });
        } catch (e) {
            breathing = false;
        }
    }

    function _startBreath() {
        breathing = false;
        breathHoldId = _clearSource(breathHoldId);
        breathStartId = _clearSource(breathStartId);
        breathDimmed = false;
        breathStartId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            HOWDY_BREATH_START_MS,
            () => {
                breathStartId = 0;
                breathing = true;
                _breathHalf();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    function _clipMs(frameCount) {
        if (!frameCount || HOWDY_PLAYBACK_RATE <= 0)
            return 0;
        return Math.round(frameCount * HOWDY_FRAME_MS / HOWDY_PLAYBACK_RATE);
    }

    function _play(frames) {
        _stopFrames();
        if (!frames || frames.length === 0) {
            _showContent(idleContent);
            return 0;
        }
        _showContent(frames[0]);
        if (frames.length === 1)
            return _clipMs(1);

        const startedUs = GLib.get_monotonic_time();
        const lastIndex = frames.length - 1;
        frameSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const elapsed = (GLib.get_monotonic_time() - startedUs) / 1000;
            const index = Math.min(lastIndex, Math.floor(elapsed * HOWDY_PLAYBACK_RATE / HOWDY_FRAME_MS));
            _showContent(frames[index]);
            if (index >= lastIndex) {
                frameSourceId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        return _clipMs(frames.length);
    }

    function showScanning() {
        _ensureIdle();
        _stopFrames();
        _stopBreath(false);
        _showContent(idleContent);
        try {
            media.set_scale(0.3, 0.3);
            media.ease({
                scale_x: 1,
                scale_y: 1,
                duration: 350,
                mode: Clutter.AnimationMode.EASE_OUT_QUINT,
            });
        } catch (e) {
            media.opacity = 255;
        }
        _startBreath();
        if (!framesReady) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                _ensureFrames();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    function playSuccess() {
        _ensureFrames();
        _stopBreath(true);
        return _play(successFrames);
    }

    function playFailure() {
        _ensureFrames();
        _stopBreath(true);
        return _play(failureFrames);
    }

    function hide() {
        _stopFrames();
        _stopBreath(false);
    }

    function destroy() {
        hide();
    }

    return {
        root,
        showScanning,
        playSuccess,
        playFailure,
        hide,
        destroy,
    };
}
