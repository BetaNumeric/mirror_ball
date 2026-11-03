'use strict';

// Run correctness: node tests/auto-align.test.cjs (also works with node --test).
// Print indicative single-run timings/errors: node tests/auto-align.test.cjs --benchmark
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const vm = require('node:vm');
const align = require('../auto-align.js');
const { circleScene, positiveScenes, negativeScenes, rankedScene, competingScene, highResolutionScene } = require('./fixtures/auto-align/scenes.cjs');

const options = { sensitivity: 0.25, bias: 0.6 };
const analyze = (scene, extra = {}) => align.analyze(scene.pixels, scene.width, scene.height, { ...options, ...extra });
const error = (circle, target) => ({ center: Math.hypot(circle.x - target.x, circle.y - target.y), radius: Math.abs(circle.r - target.r) });

function assertCircle(result, scene, tolerance = 2) {
    assert.ok(result?.best, `${scene.name}: ${result?.reason || 'no result'}`);
    const circle = result.best;
    const delta = error(circle, scene.target);
    assert.ok(Number.isFinite(circle.score) && Number.isFinite(circle.confidence), `${scene.name}: finite quality scores`);
    assert.ok(delta.center <= tolerance && delta.radius <= tolerance,
        `${scene.name}: center error ${delta.center.toFixed(3)} px, radius error ${delta.radius.toFixed(3)} px; got ${JSON.stringify(circle)}`);
    return circle;
}

async function benchmark() {
    const rows = [];
    const positives = [...positiveScenes(), rankedScene()];
    const rejected = [competingScene(), ...negativeScenes()];
    let falseAcceptances = 0, falseRejections = 0;
    let maximumCenterError = 0, maximumRadiusError = 0;
    for (const scene of [...positives, ...rejected]) {
        const started = performance.now();
        const result = analyze(scene);
        const elapsed = performance.now() - started;
        const delta = result.best && scene.target ? error(result.best, scene.target) : null;
        if (scene.target && !result.best) falseRejections++;
        if (!scene.target && result.best) falseAcceptances++;
        if (delta) {
            maximumCenterError = Math.max(maximumCenterError, delta.center);
            maximumRadiusError = Math.max(maximumRadiusError, delta.radius);
        }
        rows.push({ fixture: scene.name, accepted: Boolean(result.best),
            centerPx: delta?.center.toFixed(3) ?? '-', radiusPx: delta?.radius.toFixed(3) ?? '-',
            ms: elapsed.toFixed(1), reason: result.reason ?? '' });
    }
    const scene = highResolutionScene();
    const started = performance.now();
    const refined = align.refine(scene.pixels, scene.width, scene.height, { x: 784, y: 587, r: 415 }, options);
    const delta = refined ? error(refined, scene.target) : null;
    rows.push({ fixture: scene.name, accepted: Boolean(refined), centerPx: delta?.center.toFixed(3) ?? '-',
        radiusPx: delta?.radius.toFixed(3) ?? '-', ms: (performance.now() - started).toFixed(1), reason: '' });
    console.table(rows);
    console.log(JSON.stringify({ positiveScenes: positives.length, rejectedScenes: rejected.length,
        falseAcceptances, falseRejections, maximumCenterErrorPx: +maximumCenterError.toFixed(3),
        maximumRadiusErrorPx: +maximumRadiusError.toFixed(3) }));
    console.log('All fixtures are synthetic analytic rasters. Timings are single runs, not a hardware-independent performance guarantee.');
}

if (process.argv.includes('--benchmark')) {
    benchmark().catch(error => { console.error(error); process.exitCode = 1; });
} else {
    test('public API exposes analysis and high resolution refinement', () => {
        assert.equal(typeof align.analyze, 'function');
        assert.equal(typeof align.refine, 'function');
    });

    for (const scene of positiveScenes()) {
        test(`finds ${scene.name} against analytic ground truth`, () => {
            assertCircle(analyze(scene), scene);
        });
    }

    test('ranks the larger clear circle while retaining the separate distractor candidate', () => {
        const scene = rankedScene();
        const result = analyze(scene);
        assertCircle(result, scene);
        assert.ok(result.candidates.some(candidate => {
            const delta = error(candidate, scene.distractor);
            return delta.center < 3 && delta.radius < 3;
        }), 'the candidate list should retain the separately supported smaller circle');
    });

    test('leaves equally supported competing circles unresolved', () => {
        const scene = competingScene();
        const result = analyze(scene);
        assert.equal(result.best, null, 'two equally plausible circles need a manual choice');
        assert.ok(result.candidates.length >= 2, 'both alternatives should remain available');
        assert.equal(typeof result.reason, 'string');
        assert.ok(result.reason.length > 0, 'the caller needs a reason to explain the unchanged alignment');
    });

    test('a nearby manual prior can disambiguate otherwise equal circles', () => {
        const scene = competingScene();
        const target = scene.circles[1];
        const result = analyze(scene, { prior: { x: target.x + 2, y: target.y - 2, r: target.r + 1 } });
        assertCircle(result, { ...scene, target });
    });

    test('a supported manual estimate survives many stronger clutter proposals', () => {
        // Twenty high-contrast concentric targets generate more candidate rims
        // than the bounded proposal list can retain. The desired lower-contrast
        // circle is only near the explicit manual estimate.
        const circles = [];
        for (let i = 0; i < 20; i++) {
            for (const [r, surface] of [[34, 230], [27, 24], [20, 230]]) {
                circles.push({ x: 37 + i % 5 * 73, y: 37 + Math.floor(i / 5) * 78, r, surface });
            }
        }
        const target = { x: 435.3, y: 158.7, r: 27.4, surface: 110 };
        const scene = { name: 'manual estimate among concentric clutter', target,
            ...circleScene({ width: 480, height: 320, circles: circles.concat(target) }) };
        const result = analyze(scene, { prior: { x: target.x + 3, y: target.y - 3, r: target.r + 1 } });
        assertCircle(result, scene);
        assert.equal(result.reason, 'aligned-prior');
    });

    test('candidate selection retains ambiguity and uses a prior only for supported alternatives', () => {
        const scene = competingScene();
        const result = analyze(scene);
        const target = scene.circles[0];
        assert.equal(align.select(result.candidates, options).best, null);
        assertCircle(align.select(result.candidates, { ...options, prior: target }), { ...scene, target });
        assert.equal(align.select([], { ...options, prior: target }).best, null,
            'a prior cannot create an unsupported candidate');
    });

    test('a lower-coverage runner-up cannot hide another equally plausible circle', () => {
        const candidates = [
            { x: 60, y: 80, r: 35, score: 0.95, confidence: 0.96, coverage: 0.9 },
            { x: 160, y: 80, r: 35, score: 0.94, confidence: 0.95, coverage: 0.8 },
            { x: 260, y: 80, r: 35, score: 0.93, confidence: 0.94, coverage: 0.9 }
        ];
        const selected = align.select(candidates, options);
        assert.equal(selected.best, null, 'every similarly supported alternative must participate in ambiguity checks');
        assert.equal(selected.reason, 'ambiguous');
        assert.equal(selected.candidates.length, 3);
    });

    test('serialized worker detector gives the same analysis as the local module', () => {
        const context = { self: {} };
        vm.runInNewContext(align.workerSource(), context, { timeout: 1000 });
        const scene = rankedScene();
        const fromWorker = context.self.MirrorBallAlign.analyze(scene.pixels, scene.width, scene.height, options);
        assert.deepEqual(JSON.parse(JSON.stringify(fromWorker)), JSON.parse(JSON.stringify(analyze(scene))));
    });

    for (const scene of negativeScenes()) {
        test(`rejects ${scene.name}`, () => {
            const result = analyze(scene);
            assert.equal(result.best, null, `false circle acceptance: ${JSON.stringify(result.best)}`);
        });
    }

    test('analysis is deterministic and preserves the caller pixel data', () => {
        const scene = positiveScenes()[3];
        const before = scene.pixels.slice();
        assert.deepEqual(analyze(scene), analyze(scene));
        assert.deepEqual(scene.pixels, before);
    });

    test('high resolution rim refinement resolves a subpixel circle from a coarse estimate', () => {
        const scene = highResolutionScene();
        const before = { x: 784, y: 587, r: 415 };
        const refined = align.refine(scene.pixels, scene.width, scene.height, before, options);
        assert.ok(refined, 'a nearby complete rim should refine successfully');
        const delta = error(refined, scene.target);
        assert.ok(delta.center < 0.75 && delta.radius < 0.75,
            `center error ${delta.center.toFixed(3)} px, radius error ${delta.radius.toFixed(3)} px`);
        assert.deepEqual(before, { x: 784, y: 587, r: 415 }, 'refinement preserves its input estimate');
    });

    test('refinement declines an unsupported estimate instead of inventing a rim', () => {
        const scene = negativeScenes()[0];
        const result = align.refine(scene.pixels, scene.width, scene.height, { x: 128, y: 128, r: 80 }, options);
        assert.equal(result, null);
    });

    test('batch refinement preserves supported alternatives for a manual choice', () => {
        const scene = competingScene();
        const estimates = scene.circles.map(circle => ({ x: circle.x + 2, y: circle.y - 1, r: circle.r + 1 }));
        const refined = align.refineMany(scene.pixels, scene.width, scene.height, estimates, options);
        assert.equal(refined.length, 2);
        for (const target of scene.circles) {
            assert.ok(refined.some(circle => {
                const delta = error(circle, target);
                return delta.center < 1 && delta.radius < 1;
            }), 'both supported circles should survive batch refinement');
        }
        assert.equal(align.select(refined, options).best, null);
    });

    test('tiny and empty inputs produce no circle', () => {
        for (const [width, height] of [[0, 0], [2, 2]]) {
            const result = align.analyze(new Uint8ClampedArray(width * height * 4), width, height, options);
            assert.equal(result.best, null);
        }
    });
}
