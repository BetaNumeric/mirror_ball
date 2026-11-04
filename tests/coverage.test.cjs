'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const coverage = require('../coverage.js');
const { jpegWithExif } = require('./fixtures/coverage/exif.cjs');
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);

for (const ratio of [0.01, 0.1, 0.5, 0.9, 0.999]) {
    test(`geometry coverage agrees with independently reflected tangent rays at R/D=${ratio}`, () => {
        // Unit camera distance, sphere radius ratio. The silhouette normal is
        // perpendicular to the view ray, so reflection reverses that ray.
        const point = [ratio * Math.sqrt(1 - ratio * ratio), ratio * ratio];
        const view = [-point[0], 1 - point[1]], length = Math.hypot(...view);
        const normal = point.map(value => value / ratio), v = view.map(value => value / length);
        const dot = normal[0] * v[0] + normal[1] * v[1];
        const reflected = [2 * dot * normal[0] - v[0], 2 * dot * normal[1] - v[1]];
        const expected = Math.acos(reflected[1]) * 360 / Math.PI;
        near(coverage.fromGeometry(ratio * 2, 1).coverage, expected);
    });
}

test('focal calibration recovers known angular image radii', () => {
    const width = 3600, height = 2400, f35 = 50, focalPixels = 5000;
    near(coverage.fromFocalLength(focalPixels, width, height, f35).coverage, 270);
    near(coverage.fromFocalLength(focalPixels / Math.sqrt(3), width, height, f35).coverage, 300);
});

test('uniform resizing and EXIF orientation do not change angular coverage', () => {
    const original = coverage.fromFocalLength(950, 5184, 3888, 140).coverage;
    near(coverage.fromFocalLength(475, 2592, 1944, 140).coverage, original);
    near(coverage.fromFocalLength(950, 3888, 5184, 140).coverage, original);
});

test('geometry and lens calibration agree for a perspective sphere silhouette', () => {
    const radius = 50, distance = 1000, focalPixels = 5000;
    const apparentRadius = focalPixels * radius / Math.sqrt(distance * distance - radius * radius);
    near(coverage.fromFocalLength(apparentRadius, 3600, 2400, 50).coverage, coverage.fromGeometry(radius * 2, distance).coverage);
});

test('geometry depends on the size-to-distance ratio and avoids intermediate overflow', () => {
    near(coverage.fromGeometry(100, 1000).coverage, coverage.fromGeometry(.1, 1).coverage);
    near(coverage.fromGeometry(1e308, 1e308).coverage, 300);
});

test('geometry and focal calculations reject missing, nonfinite, and impossible inputs', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
        assert.ok(coverage.fromGeometry(bad, 1000).reason);
        assert.ok(coverage.fromGeometry(100, bad).reason);
        assert.ok(coverage.fromFocalLength(bad, 100, 100, 50).reason);
        assert.ok(coverage.fromFocalLength(20, 100, 100, bad).reason);
    }
    assert.equal(coverage.fromGeometry(100, 50).reason, 'camera-inside-ball');
    assert.equal(coverage.fromGeometry(100, 20).reason, 'camera-inside-ball');
});

for (const little of [true, false]) {
    test(`JPEG EXIF reader handles ${little ? 'little' : 'big'} endian TIFF and JPEG dimensions`, () => {
        const info = coverage.parseJpegExif(jpegWithExif({ little, orientation: 6 }));
        assert.deepEqual(info, { focalLength35mm: 140, focalLength: 70, width: 5184, height: 3888,
            digitalZoom: 0, orientation: 6, encodedWidth: 5184, encodedHeight: 3888 });
    });
}

test('metadata mode uses equivalent focal length and never assumes a sensor size from physical focal length', () => {
    const info = coverage.parseJpegExif(jpegWithExif());
    const result = coverage.estimate({ mode: 'metadata', metadata: info, radius: 950, width: 5184, height: 3888 });
    near(result.coverage, coverage.fromFocalLength(950, 5184, 3888, 140).coverage);
    assert.equal(result.source, 'metadata');
    assert.equal(coverage.estimate({ metadata: { focalLength: 70 }, radius: 950, width: 5184, height: 3888 }).reason, 'metadata-required');
    assert.equal(coverage.estimate({ metadata: { focalLength35mm: 0 }, radius: 950, width: 5184, height: 3888 }).reason, 'metadata-required');
});

test('metadata mode declines digital zoom and inconsistent dimensions', () => {
    const args = { mode: 'metadata', radius: 950, width: 5184, height: 3888 };
    assert.equal(coverage.estimate({ ...args, metadata: coverage.parseJpegExif(jpegWithExif({ digitalZoom: 2 })) }).reason, 'digital-zoom');
    assert.equal(coverage.estimate({ ...args, metadata: coverage.parseJpegExif(jpegWithExif({}, { width: 1920, height: 1080 })) }).reason, 'edited-dimensions');
});

test('a larger apparent sphere produces a larger blind cone', () => {
    const a = coverage.fromFocalLength(400, 1920, 1080, 100), b = coverage.fromFocalLength(600, 1920, 1080, 100);
    assert.ok(b.blindSpot > a.blindSpot && b.coverage < a.coverage);
    near(a.blindSpot + a.coverage, 360);
});

test('reader skips unrelated APP1 segments and recognizes progressive JPEG dimensions', () => {
    const jpeg = jpegWithExif(), prefix = Buffer.from([0xff, 0xe1, 0, 8, 88, 77, 80, 0, 0, 0]);
    const combined = Buffer.concat([jpeg.subarray(0, 2), prefix, jpeg.subarray(2)]);
    const marker = combined.indexOf(Buffer.from([0xff, 0xc0])); combined[marker + 1] = 0xc2;
    assert.equal(coverage.parseJpegExif(combined).encodedWidth, 5184);
});

test('truncated or corrupt metadata cannot throw or read outside its segment', () => {
    const jpeg = jpegWithExif();
    for (let size = 0; size < jpeg.length; size++) assert.doesNotThrow(() => coverage.parseJpegExif(jpeg.subarray(0, size)));
    const corrupt = Buffer.from(jpeg); corrupt.writeUInt32LE(0xfffffff0, 16);
    assert.equal(coverage.parseJpegExif(corrupt), null);
    const cycle = Buffer.from(jpeg); cycle.writeUInt32LE(8, 42);
    assert.doesNotThrow(() => coverage.parseJpegExif(cycle));
    assert.equal(coverage.parseJpegExif(new Uint8Array(400)), null);
});

test('metadata reading is bounded to one MiB and never requests an entire file', async () => {
    let requested;
    const file = { size: 5e9, slice(start, end) { requested = [start, end]; return new Blob([jpegWithExif()]); }, arrayBuffer() { throw new Error('whole-file read'); } };
    assert.equal((await coverage.readJpegExif(file)).focalLength35mm, 140);
    assert.deepEqual(requested, [0, 1024 * 1024]);
    assert.equal(await coverage.readJpegExif({ slice() { throw new Error('read failed'); } }), null);
});
