'use strict';

// Analytic fixtures use canvas coordinates: pixel (x, y) samples (x + .5, y + .5).
// The half-pixel transition approximates antialiased coverage; no detector code is used.
const clamp = value => Math.max(0, Math.min(1, value));

function raster(width, height, sample) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4;
            const value = sample(x + 0.5, y + 0.5);
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
            pixels[offset + 3] = 255;
        }
    }
    return pixels;
}

function circleScene({ width = 320, height = 256, circles, background = 24, overlay }) {
    const pixels = raster(width, height, (x, y) => {
        let value = typeof background === 'function' ? background(x, y) : background;
        for (const circle of circles) {
            const distance = Math.hypot(x - circle.x, y - circle.y);
            const alpha = clamp(circle.r + 0.5 - distance);
            const surface = typeof circle.surface === 'function' ? circle.surface(x, y) : circle.surface ?? 190;
            value += alpha * (surface - value);
        }
        return overlay ? overlay(x, y, value) : value;
    });
    return { width, height, pixels };
}

function disk(name, target, options = {}) {
    return { name, target, ...circleScene({ circles: [target], ...options }) };
}

function positiveScenes() {
    return [
        disk('fractional circle', { x: 154.35, y: 123.7, r: 85.45 }),
        disk('portrait image', { x: 118.6, y: 176.2, r: 93.65 }, { width: 240, height: 320 }),
        disk('dark circle', { x: 153.8, y: 130.25, r: 88.3, surface: 35 }, { background: 190 }),
        disk('texture and glare', {
            x: 153.4, y: 128.8, r: 91.6,
            surface: (x, y) => 135 + 25 * Math.sin(x * 0.14) * Math.cos(y * 0.1)
                + 75 * Math.exp(-((x - 130) ** 2 + (y - 102) ** 2) / 160),
        }, {
            background: (x, y) => 22 + x / 35 + 3 * Math.sin(y * 0.12),
            overlay: (x, y, value) => x > 147 && x < 189 && y > 93 && y < 151 ? 218 : value,
        }),
        disk('low contrast with bright outlier', { x: 163.15, y: 128.6, r: 82.75, surface: 116 }, {
            background: 73,
            overlay: (x, y, value) => Math.hypot(x - 30, y - 30) < 3 ? 255 : value,
        }),
        disk('moderately occluded rim', { x: 155.6, y: 127.35, r: 87.8 }, {
            // This foreground object hides about 20% of the rim and adds straight edges.
            overlay: (x, y, value) => x > 194 && y > 80 && y < 175 ? 45 : value,
        }),
        disk('cropped circle', { x: 42.3, y: 126.7, r: 101.4 }, { width: 256, height: 256 }),
        disk('center outside image', { x: -10.2, y: 128.4, r: 109.7 }, { width: 256, height: 256 }),
    ];
}

function competingScene() {
    const circles = [{ x: 90, y: 128, r: 50 }, { x: 230, y: 128, r: 50 }];
    return { name: 'equally supported circles', circles, ...circleScene({ circles }) };
}

function rankedScene() {
    const target = { x: 190.3, y: 129.7, r: 84.4 };
    const distractor = { x: 52.8, y: 55.3, r: 29.6 };
    return { name: 'circle with separate smaller distractor', target, distractor,
        ...circleScene({ circles: [distractor, target] }) };
}

function negativeScenes() {
    const width = 256, height = 256;
    const scene = (name, sample) => ({ name, width, height, pixels: raster(width, height, sample) });
    let state = 12345;
    const transparent = scene('transparent RGB edges', (x, y) => Math.hypot(x - 128, y - 128) < 80 ? 255 : 0);
    for (let i = 3; i < transparent.pixels.length; i += 4) transparent.pixels[i] = 0;
    return [
        scene('blank', () => 64),
        transparent,
        scene('rectangle', (x, y) => x > 52 && x < 205 && y > 66 && y < 192 ? 220 : 24),
        scene('elongated ellipse', (x, y) => {
            const normalized = Math.hypot((x - 128) / 94, (y - 128) / 54);
            return 24 + 196 * clamp((1 - normalized) * 54 + 0.5);
        }),
        scene('short 126 degree arc', (x, y) => {
            const angle = Math.atan2(y - 128, x - 128);
            return angle >= 0 && angle <= Math.PI * 0.7
                ? 220 * clamp(1.5 - Math.abs(Math.hypot(x - 128, y - 128) - 76)) : 0;
        }),
        scene('seeded independent noise', () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state >>> 24;
        }),
        scene('smooth illumination gradient', (x, y) => 15 + 0.4 * x + 0.2 * y),
    ];
}

function highResolutionScene() {
    return disk('high resolution rim refinement', { x: 780.35, y: 590.65, r: 411.25 }, {
        width: 1600, height: 1200,
        background: (x, y) => 20 + x / 200 + y / 400,
        circles: [{ x: 780.35, y: 590.65, r: 411.25,
            surface: (x, y) => 142 + 16 * Math.sin(x * 0.035) * Math.cos(y * 0.027) }],
    });
}

module.exports = { raster, circleScene, positiveScenes, negativeScenes, rankedScene, competingScene, highResolutionScene };
