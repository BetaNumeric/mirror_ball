'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { performance } = require('node:perf_hooks');
const vm = require('node:vm');
const align = require('../auto-align.js');
const { circleScene, positiveScenes, negativeScenes } = require('./fixtures/auto-align/scenes.cjs');

const options = { sensitivity: 0.25 };
const run = (scene, candidate) => align.track(scene.pixels, scene.width, scene.height, candidate, options);
const near = (circle, target) => circle && Math.hypot(circle.x - target.x, circle.y - target.y) < 0.75 && Math.abs(circle.r - target.r) < 0.75;

if (process.argv.includes('--benchmark')) {
    const results = [];
    for (const width of [320, 512, 768, 1536]) {
        const height = width * 0.75, target = { x: width * 0.48, y: height * 0.52, r: height * 0.32 };
        const scene = circleScene({ width, height, circles: [target] });
        const candidate = { x: target.x + 2, y: target.y - 1, r: target.r + 1 };
        const measure = method => {
            const times = [];
            for (let i = 0; i < 26; i++) {
                const before = performance.now();
                const circle = align[method](scene.pixels, width, height, candidate, options);
                const elapsed = performance.now() - before;
                assert.ok(near(circle, target), method + ' must retain analytic accuracy');
                if (i >= 6) times.push(elapsed);
            }
            times.sort((a, b) => a - b);
            return { p50: times[10], p90: times[18] };
        };
        const refine = measure('refine'), track = measure('track');
        results.push({ width, height, refineP50ms: +refine.p50.toFixed(2), trackP50ms: +track.p50.toFixed(2),
            trackP90ms: +track.p90.toFixed(2), speedup: +(refine.p50 / track.p50).toFixed(2) });
    }
    console.table(results);
    console.log('Warm Node timings on synthetic circles; capture, transfer, display and full searches are excluded. Not a frame-rate guarantee.');
} else {
    for (const scene of positiveScenes()) {
        test('fast tracking preserves supported ' + scene.name, () => {
            const candidate = { x: scene.target.x + 1, y: scene.target.y - 1, r: scene.target.r + 1 };
            const before = { ...candidate }, pixels = scene.pixels.slice();
            const circle = run(scene, candidate);
            assert.ok(near(circle, scene.target), JSON.stringify(circle));
            assert.deepEqual(candidate, before);
            assert.deepEqual(scene.pixels, pixels);
        });
    }

    for (const scene of negativeScenes()) {
        test('fast tracking rejects ' + scene.name, () => {
            assert.equal(run(scene, { x: 128, y: 128, r: 76 }), null);
        });
    }

    test('a moving and resizing circle stays accurate across reused buffers', () => {
        let candidate = { x: 230, y: 180, r: 90 };
        for (let frame = 0; frame < 12; frame++) {
            const target = { x: 230.3 + frame * 2.2, y: 180.7 - frame * 0.8, r: 90.2 + frame * 0.45 };
            const scene = circleScene({ width: 512, height: 384, circles: [target] });
            const tracked = run(scene, candidate);
            assert.ok(near(tracked, target), JSON.stringify({ frame, tracked, target }));
            candidate = tracked;
        }
    });

    test('reusing buffers after a valid circle cannot invent an edge in a blank frame', () => {
        const target = { x: 230.3, y: 180.7, r: 90.2 };
        const scene = circleScene({ width: 512, height: 384, circles: [target] });
        assert.ok(run(scene, target));
        const blank = new Uint8ClampedArray(scene.pixels.length); blank.fill(128);
        for (let i = 3; i < blank.length; i += 4) blank[i] = 255;
        assert.equal(align.track(blank, scene.width, scene.height, target), null);
    });

    test('fast tracking is local and cannot jump to a distant separate circle', () => {
        const scene = circleScene({ width: 512, height: 384, circles: [{ x: 380, y: 200, r: 55 }] });
        assert.equal(run(scene, { x: 100, y: 180, r: 60 }), null);
    });

    test('fast tracking implementation serializes into the worker unchanged', () => {
        const context = { self: {} };
        vm.runInNewContext(align.workerSource(), context, { timeout: 1000 });
        const scene = positiveScenes()[3], candidate = { ...scene.target, x: scene.target.x + 1 };
        const expected = run(scene, candidate);
        const actual = context.self.MirrorBallAlign.track(scene.pixels, scene.width, scene.height, candidate, options);
        assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
    });

    test('invalid fast tracking inputs are declined without allocation or fitting', () => {
        assert.equal(align.track(new Uint8ClampedArray(16), 2, 2, { x: 1, y: 1, r: 6 }), null);
        assert.equal(align.track(new Uint8ClampedArray(128 * 128 * 4), 128, 128, { x: NaN, y: 64, r: 40 }), null);
        assert.equal(align.track(new Uint8ClampedArray(128 * 128 * 4), 128, 128, { x: 64, y: 64, r: -1 }), null);
    });
}
