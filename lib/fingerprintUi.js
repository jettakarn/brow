import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import {
    AUTH_SQUARE_SIZE,
    AUTH_RING_SIZE,
    AUTH_BREATH_MS,
    AUTH_BREATH_OP_MIN,
    AUTH_BREATH_OP_MAX,
    AUTH_SPIN_MS,
    AUTH_SHAKE_MS,
    AUTH_FRAME_SIZE,
    AUTH_CORNER_SIZE,
} from './constants.js';

function pickFingerIcon() {
    return 'auth-fingerprint-symbolic';
}

/**
 * Face-ID-style fingerprint overlay for the auth square.
 * Scan rim and success rim share AUTH_RING_SIZE so diameters never drift.
 */
export function buildFingerprintUi() {
    const root = new St.Widget({
        style_class: 'brow-auth-root',
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
        opacity: 0,
    });

    // Outer perimeter stroke on the black square (breathes with scan).
    // Explicit size — BinLayout alone does not reliably expand to fill.
    const islandEdge = new St.Widget({
        style_class: 'brow-auth-island-edge',
        width: AUTH_SQUARE_SIZE,
        height: AUTH_SQUARE_SIZE,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        opacity: 0,
    });

    function _makeRing() {
        const ring = new St.Widget({
            style_class: 'brow-auth-ring',
            width: AUTH_RING_SIZE,
            height: AUTH_RING_SIZE,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
        });
        try {
            ring.set_pivot_point(0.5, 0.5);
        } catch (e) {
            // ignore
        }
        try {
            ring.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        } catch (e) {
            // ignore
        }
        return ring;
    }

    // Scan and success share one ring. Ghosts lag behind it during the tumble.
    const outerRim = _makeRing();
    const ghostNear = _makeRing();
    const ghostFar = _makeRing();
    const ghosts = [ghostNear, ghostFar];

    const frame = new St.Widget({
        style_class: 'brow-auth-frame',
        width: AUTH_FRAME_SIZE,
        height: AUTH_FRAME_SIZE,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        layout_manager: new Clutter.BinLayout(),
        opacity: 0,
    });

    for (const pos of ['tl', 'tr', 'bl', 'br']) {
        const c = new St.Widget({
            style_class: `brow-auth-corner brow-auth-corner-${pos}`,
            width: AUTH_CORNER_SIZE,
            height: AUTH_CORNER_SIZE,
        });
        if (pos === 'tl') {
            c.x_align = Clutter.ActorAlign.START;
            c.y_align = Clutter.ActorAlign.START;
        } else if (pos === 'tr') {
            c.x_align = Clutter.ActorAlign.END;
            c.y_align = Clutter.ActorAlign.START;
        } else if (pos === 'bl') {
            c.x_align = Clutter.ActorAlign.START;
            c.y_align = Clutter.ActorAlign.END;
        } else {
            c.x_align = Clutter.ActorAlign.END;
            c.y_align = Clutter.ActorAlign.END;
        }
        frame.add_child(c);
    }

    const finger = new St.Icon({
        icon_name: pickFingerIcon(),
        style_class: 'brow-auth-finger',
        icon_size: 34,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        opacity: 0,
    });

    const check = new St.Icon({
        icon_name: 'emblem-ok-symbolic',
        style_class: 'brow-auth-check',
        icon_size: 36,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        opacity: 0,
        visible: false,
    });

    // Same centerline as the reference check. Drawn as one round stroke so the
    // corner is a single join, not two capsules.
    const checkPath = [
        [-8.0, 1.7],
        [-1.7, 9.1],
        [9.1, -5.7],
    ];
    const checkLens = [
        Math.hypot(checkPath[1][0] - checkPath[0][0], checkPath[1][1] - checkPath[0][1]),
        Math.hypot(checkPath[2][0] - checkPath[1][0], checkPath[2][1] - checkPath[1][1]),
    ];
    const checkSurface = new Cairo.ImageSurface(
        Cairo.Format.ARGB32,
        AUTH_RING_SIZE,
        AUTH_RING_SIZE,
    );
    const checkCr = new Cairo.Context(checkSurface);
    const checkImage = St.ImageContent.new_with_preferred_size(AUTH_RING_SIZE, AUTH_RING_SIZE);
    const checkPaint = new St.Widget({
        width: AUTH_RING_SIZE,
        height: AUTH_RING_SIZE,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        opacity: 0,
    });
    checkPaint.set_content(checkImage);
    const checkPng = GLib.build_filenamev([GLib.get_tmp_dir(), 'brow-check.png']);

    function _paintCheck(dist) {
        const size = AUTH_RING_SIZE;
        const cr = checkCr;
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);
        if (dist > 0.4) {
            const [a, b, c] = checkPath;
            const ox = size / 2;
            const oy = size / 2;
            cr.setSourceRGBA(0.486, 1, 0.420, 1);
            cr.setLineWidth(4.6);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            cr.moveTo(ox + a[0], oy + a[1]);
            if (dist < checkLens[0]) {
                const t = dist / checkLens[0];
                cr.lineTo(
                    ox + a[0] + (b[0] - a[0]) * t,
                    oy + a[1] + (b[1] - a[1]) * t,
                );
            } else {
                const t = Math.min(1, (dist - checkLens[0]) / checkLens[1]);
                cr.lineTo(ox + b[0], oy + b[1]);
                cr.lineTo(
                    ox + b[0] + (c[0] - b[0]) * t,
                    oy + b[1] + (c[1] - b[1]) * t,
                );
            }
            cr.stroke();
        }
        checkSurface.flush();
        checkSurface.writeToPNG(checkPng);
        const pb = GdkPixbuf.Pixbuf.new_from_file(checkPng);
        const copy = new Uint8Array(pb.get_pixels());
        checkImage.set_bytes(
            GLib.Bytes.new(copy),
            Cogl.PixelFormat.RGBA_8888,
            size,
            size,
            pb.get_rowstride(),
        );
        checkPaint.opacity = dist > 0.4 ? 255 : 0;
    }

    root.add_child(islandEdge);
    root.add_child(ghostFar);
    root.add_child(ghostNear);
    root.add_child(outerRim);
    root.add_child(frame);
    root.add_child(finger);
    root.add_child(check);
    root.add_child(checkPaint);

    const breathActors = [islandEdge, outerRim, frame, finger];
    let breathing = false;
    let breathGoingUp = true;
    let successCb = null;
    let tumbleGen = 0;
    let tumbleSource = 0;

    function _stopTumble() {
        tumbleGen += 1;
        if (tumbleSource) {
            GLib.source_remove(tumbleSource);
            tumbleSource = 0;
        }
        for (const actor of [outerRim, ghostNear, ghostFar]) {
            try {
                actor.remove_all_transitions();
            } catch (e) {
                // ignore
            }
        }
        checkPaint.opacity = 0;
    }

    function _poseRing(actor, angleY, tiltX, opacity) {
        try {
            actor.rotation_angle_z = 0;
            actor.rotation_angle_y = angleY;
            actor.rotation_angle_x = tiltX;
            if (opacity !== undefined)
                actor.opacity = opacity;
        } catch (e) {
            // ignore
        }
    }

    function _resetRingScale(actor) {
        try {
            actor.set_pivot_point(0.5, 0.5);
            actor.set_scale(1, 1);
        } catch (e) {
            // ignore
        }
    }

    function _settleRing() {
        _poseRing(outerRim, 0, 0, 255);
        _resetRingScale(outerRim);
        for (const ghost of ghosts) {
            _poseRing(ghost, 0, 0, 0);
            _resetRingScale(ghost);
        }
    }

    function _breathGroup() {
        return breathActors.filter(a => {
            try {
                return a && !a.destroyed;
            } catch (e) {
                return false;
            }
        });
    }

    function _clearBreath() {
        breathing = false;
        for (const a of _breathGroup()) {
            try {
                a.remove_all_transitions();
            } catch (e) {
                // ignore
            }
        }
    }

    function _breathStep() {
        if (!breathing)
            return;

        const target = breathGoingUp ? AUTH_BREATH_OP_MAX : AUTH_BREATH_OP_MIN;
        breathGoingUp = !breathGoingUp;
        const actors = _breathGroup();
        if (actors.length === 0)
            return;

        let remaining = actors.length;
        const onOneDone = () => {
            remaining--;
            if (remaining <= 0 && breathing)
                _breathStep();
        };

        for (const a of actors) {
            try {
                a.ease({
                    opacity: target,
                    duration: AUTH_BREATH_MS / 2,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                    onComplete: onOneDone,
                });
            } catch (e) {
                onOneDone();
            }
        }
    }

    function _startBreath() {
        _clearBreath();
        breathing = true;
        breathGoingUp = false;
        for (const a of _breathGroup()) {
            try {
                a.opacity = AUTH_BREATH_OP_MAX;
            } catch (e) {
                // ignore
            }
        }
        _breathStep();
    }

    function showScanning() {
        _stopTumble();
        successCb = null;
        check.visible = false;
        check.opacity = 0;
        try {
            check.set_scale(1, 1);
        } catch (e) {
            // ignore
        }
        _settleRing();

        islandEdge.visible = true;
        finger.visible = true;
        frame.visible = true;
        outerRim.visible = true;

        for (const a of [islandEdge, outerRim, frame, finger]) {
            try {
                a.remove_all_transitions();
                a.opacity = AUTH_BREATH_OP_MAX;
            } catch (e) {
                // ignore
            }
        }
        _startBreath();
    }

    function shake() {
        const targets = [finger, frame];
        for (const t of targets) {
            try {
                t.remove_all_transitions();
                t.translation_x = 0;
            } catch (e) {
                // ignore
            }
        }

        // Pause breath opacity fights during shake
        const wasBreathing = breathing;
        if (wasBreathing)
            _clearBreath();

        const step = AUTH_SHAKE_MS / 6;
        const run = (actor, then) => {
            actor.ease({
                translation_x: -8,
                duration: step,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    actor.ease({
                        translation_x: 8,
                        duration: step,
                        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                        onComplete: () => {
                            actor.ease({
                                translation_x: -6,
                                duration: step,
                                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                                onComplete: () => {
                                    actor.ease({
                                        translation_x: 0,
                                        duration: step,
                                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                        onComplete: then,
                                    });
                                },
                            });
                        },
                    });
                },
            });
        };

        try {
            let pending = targets.length;
            const done = () => {
                pending--;
                if (pending <= 0 && wasBreathing)
                    _startBreath();
            };
            for (const t of targets)
                run(t, done);
        } catch (e) {
            if (wasBreathing)
                _startBreath();
        }
    }

    function _showCheck() {
        _settleRing();
        check.visible = true;
        check.opacity = 0;
        try {
            check.set_pivot_point(0.5, 0.5);
            check.set_scale(0.85, 0.85);
            check.remove_all_transitions();
            check.ease({
                opacity: 255,
                scale_x: 1,
                scale_y: 1,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    successCb?.();
                    successCb = null;
                },
            });
        } catch (e) {
            check.opacity = 255;
            successCb?.();
            successCb = null;
        }
    }

    function playSuccess(onDone) {
        _clearBreath();
        _stopTumble();
        const gen = tumbleGen;
        successCb = onDone;

        // Same ring as the scan, held at full opacity through the tumble.
        try {
            outerRim.remove_all_transitions();
            outerRim.opacity = 255;
            outerRim.visible = true;
        } catch (e) {
            // ignore
        }

        try {
            islandEdge.ease({ opacity: 0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            frame.ease({ opacity: 0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            finger.ease({ opacity: 0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        } catch (e) {
            islandEdge.opacity = 0;
            frame.opacity = 0;
            finger.opacity = 0;
        }

        // Clutter.Canvas is not a constructor here, so the drawn tumble never
        // appeared. Two border rings, scaled on opposite axes, stay visible.
        const minScale = 0.28;
        const axis = angle => minScale + (1 - minScale) * Math.abs(Math.cos(angle));
        _resetRingScale(outerRim);
        _resetRingScale(ghostNear);
        _poseRing(outerRim, 0, 0, 255);
        _poseRing(ghostNear, 0, 0, 150);
        ghostFar.opacity = 0;
        check.opacity = 0;
        check.visible = false;
        const startedUs = GLib.get_monotonic_time();
        try {
            tumbleSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                if (gen !== tumbleGen) {
                    tumbleSource = 0;
                    return GLib.SOURCE_REMOVE;
                }
                const elapsed = (GLib.get_monotonic_time() - startedUs) / 1000;
                const p = Math.min(1, elapsed / AUTH_SPIN_MS);
                const eased = 1 - Math.pow(1 - p, 2);
                const spin = eased * Math.PI * 2;
                const settle = p < 0.72 ? 0 : (p - 0.72) / 0.28;
                const sx = axis(spin);
                const sy = axis(spin + Math.PI / 2);
                try {
                    outerRim.scale_x = sx * (1 - settle) + settle;
                    outerRim.scale_y = sy * (1 - settle) + settle;
                    outerRim.opacity = 255;
                    ghostNear.scale_x = sy * (1 - settle) + settle;
                    ghostNear.scale_y = sx * (1 - settle) + settle;
                    ghostNear.opacity = Math.round(150 * (1 - settle));
                } catch (e) {
                    // ignore
                }
                if (p < 1)
                    return GLib.SOURCE_CONTINUE;
                tumbleSource = 0;
                _resetRingScale(outerRim);
                _resetRingScale(ghostNear);
                ghostNear.opacity = 0;
                outerRim.opacity = 255;
                const drawMs = 420;
                const drawStart = GLib.get_monotonic_time();
                const checkTotal = checkLens[0] + checkLens[1];
                tumbleSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                    if (gen !== tumbleGen) {
                        tumbleSource = 0;
                        return GLib.SOURCE_REMOVE;
                    }
                    const elapsed = (GLib.get_monotonic_time() - drawStart) / 1000;
                    const p = Math.min(1, elapsed / drawMs);
                    const eased = p < 0.82
                        ? p
                        : 0.82 + (1 - Math.pow(1 - (p - 0.82) / 0.18, 2)) * 0.18;
                    const dist = eased * checkTotal;
                    try {
                        _paintCheck(dist);
                    } catch (e) {
                        // ignore
                    }
                    if (p < 1)
                        return GLib.SOURCE_CONTINUE;
                    try {
                        _paintCheck(checkTotal);
                    } catch (e) {
                        // ignore
                    }
                    tumbleSource = 0;
                    successCb?.();
                    successCb = null;
                    return GLib.SOURCE_REMOVE;
                });
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            tumbleGen += 1;
            _showCheck();
        }
    }

    function hide() {
        _clearBreath();
        _stopTumble();
        successCb = null;
        for (const a of [islandEdge, outerRim, ghostNear, ghostFar, frame, finger, check]) {
            try {
                a.remove_all_transitions();
            } catch (e) {
                // ignore
            }
        }
        islandEdge.opacity = 0;
        frame.opacity = 0;
        finger.opacity = 0;
        check.opacity = 0;
        finger.translation_x = 0;
        frame.translation_x = 0;
        check.visible = false;
        try {
            check.set_scale(1, 1);
        } catch (e) {
            // ignore
        }
        _settleRing();
        outerRim.opacity = 0;
    }

    function destroy() {
        hide();
    }

    return {
        root,
        showScanning,
        shake,
        playSuccess,
        hide,
        destroy,
    };
}
