'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createTracker } = require('../auto-align.js');

test('stationary rim noise does not move the circle', () => {
    const tracker = createTracker(), target = { x: 150, y: 120, r: 90 };
    tracker.update(target, 0);
    for (let frame = 1; frame <= 60; frame++) {
        const noise = Math.sin(frame * 2.3) * 0.3;
        assert.deepEqual(tracker.update({ x: target.x + noise, y: target.y - noise, r: target.r + noise }, frame / 30), target);
    }
});

test('tracking follows sustained motion and size changes without freezing', () => {
    const tracker = createTracker();
    let circle;
    for (let frame = 0; frame <= 60; frame++) circle = tracker.update({ x: 100 + frame, y: 90, r: 70 + frame * 0.2 }, frame / 30);
    assert.ok(circle.x > 157 && circle.x <= 160, JSON.stringify(circle));
    assert.ok(circle.r > 81 && circle.r <= 82, JSON.stringify(circle));
});

test('missing evidence and a transient distant circle cannot replace a lock', () => {
    const tracker = createTracker(), target = { x: 100, y: 100, r: 70 };
    assert.deepEqual(tracker.update(target, 0), target);
    assert.equal(tracker.update(null, 0.1), null);
    assert.equal(tracker.update({ x: 400, y: 100, r: 90 }, 0.2), null);
    assert.equal(tracker.update(null, 0.3), null);
    assert.equal(tracker.update({ x: 400, y: 100, r: 90 }, 0.4), null, 'failed evidence resets jump confirmation');
    assert.deepEqual(tracker.update(target, 0.5), target);
});

test('consistent supported detections can reacquire after a large move', () => {
    const tracker = createTracker(), target = { x: 400, y: 100, r: 90 };
    tracker.update({ x: 100, y: 100, r: 70 }, 0);
    assert.equal(tracker.update(target, 0.1), null);
    assert.deepEqual(tracker.update({ ...target, x: 401 }, 0.2), { ...target, x: 401 });
});

test('backward time starts a fresh segment and malformed circles cannot corrupt it', () => {
    const tracker = createTracker();
    tracker.update({ x: 400, y: 100, r: 90 }, 10);
    assert.equal(tracker.update({ x: NaN, y: 1, r: 1 }, 11), null);
    assert.equal(tracker.update({ x: 1, y: 1, r: -1 }, 11), null);
    assert.deepEqual(tracker.update({ x: 100, y: 100, r: 70 }, 0), { x: 100, y: 100, r: 70 });
});
