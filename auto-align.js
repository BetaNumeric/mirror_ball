/* Local, dependency-free circle alignment. Kept in one factory so Blob workers
 * can use the same implementation when the application is opened from disk. */
(function (root, factory) {
    'use strict';
    const api = factory();
    api.workerSource = function () { return 'self.MirrorBallAlign = (' + factory.toString() + ')();'; };
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MirrorBallAlign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const TAU = Math.PI * 2;
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const median = values => {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    };

    function field(pixels, width, height, sensitivity) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 ||
            width * height > 4194304 || !pixels || pixels.length < width * height * 4) return null;
        const count = width * height;
        const gray = new Float32Array(count);
        const gx = new Float32Array(count);
        const gy = new Float32Array(count);
        const magnitude = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const j = i * 4;
            gray[i] = (pixels[j] * 0.299 + pixels[j + 1] * 0.587 + pixels[j + 2] * 0.114) * pixels[j + 3] / 255;
        }
        let maximum = 0;
        const histogram = new Uint32Array(1450);
        let nonzero = 0;
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = y * width + x;
                const a = i - width, b = i + width;
                const dx = -gray[a - 1] + gray[a + 1] - 2 * gray[i - 1] + 2 * gray[i + 1] - gray[b - 1] + gray[b + 1];
                const dy = -gray[a - 1] - 2 * gray[a] - gray[a + 1] + gray[b - 1] + 2 * gray[b] + gray[b + 1];
                const mag = Math.hypot(dx, dy);
                gx[i] = dx; gy[i] = dy; magnitude[i] = mag;
                maximum = Math.max(maximum, mag);
                if (mag >= 6) { histogram[Math.min(1449, Math.floor(mag))]++; nonzero++; }
            }
        }
        if (maximum < 8 || nonzero < 32) return null;
        // An isolated white highlight should not hide a lower-contrast outer rim.
        let percentile = 0, total = 0;
        for (; percentile < histogram.length - 1; percentile++) {
            total += histogram[percentile];
            if (total >= nonzero * 0.7) break;
        }
        const threshold = Math.max(7, Math.min(maximum * clamp(Number.isFinite(sensitivity) ? sensitivity : 0.25, 0.05, 0.9), percentile * 0.7));
        return { width, height, gx, gy, magnitude, threshold, maximum };
    }

    // The field is indexed by pixel centres: (0.5,0.5), (1.5,0.5), ... .
    function sample(values, data, x, y) {
        x -= 0.5; y -= 0.5;
        if (x < 1 || y < 1 || x >= data.width - 2 || y >= data.height - 2) return 0;
        const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
        const i = iy * data.width + ix;
        return (values[i] * (1 - tx) + values[i + 1] * tx) * (1 - ty) +
            (values[i + data.width] * (1 - tx) + values[i + data.width + 1] * tx) * ty;
    }

    function edgePoints(data) {
        const points = [];
        const { width, height, magnitude, gx, gy, threshold } = data;
        for (let y = 2; y < height - 2; y++) {
            for (let x = 2; x < width - 2; x++) {
                const i = y * width + x, mag = magnitude[i];
                if (mag < threshold) continue;
                const nx = gx[i] / mag, ny = gy[i] / mag;
                // Suppress the thick sides of a Sobel edge without requiring a
                // particular contrast polarity at the sphere boundary.
                const dx = Math.abs(nx) >= Math.abs(ny) ? 1 : 0;
                const dy = dx ? 0 : 1;
                if (mag < magnitude[i + dx + dy * width] || mag < magnitude[i - dx - dy * width]) continue;
                points.push({ x: x + 0.5, y: y + 0.5, nx, ny, weight: Math.sqrt(mag / data.maximum) });
            }
        }
        if (points.length <= 10000) return points;
        // Uniform spatial subsampling, rather than taking only bright edges.
        const sampled = [];
        const stride = points.length / 10000;
        for (let i = 0; i < 10000; i++) sampled.push(points[Math.floor(i * stride)]);
        return sampled;
    }

    function proposals(data, edges, options) {
        const { width, height } = data;
        const size = Math.max(width, height);
        const step = Math.max(1, size / 256);
        const left = -width * 0.55, top = -height * 0.55;
        const aw = Math.ceil(width * 2.1 / step), ah = Math.ceil(height * 2.1 / step);
        const votes = new Float32Array(aw * ah);
        const minR = Math.max(9, Math.min(width, height) * 0.055);
        const maxR = Math.hypot(width, height) * 0.85;
        const radiusStep = Math.max(2, size / 150);
        // At most about two million weighted gradient votes on a 320px image.
        const edgeStride = Math.max(1, Math.ceil(edges.length / 6500));
        for (let e = 0; e < edges.length; e += edgeStride) {
            const point = edges[e];
            for (let radius = minR; radius <= maxR; radius += radiusStep) {
                for (let sign = -1; sign <= 1; sign += 2) {
                    const x = Math.round((point.x + point.nx * radius * sign - left) / step);
                    const y = Math.round((point.y + point.ny * radius * sign - top) / step);
                    if (x >= 0 && y >= 0 && x < aw && y < ah) votes[y * aw + x] += point.weight;
                }
            }
        }
        const peaks = [];
        // Small neighbouring bins share votes when the true centre is fractional.
        for (let y = 1; y < ah - 1; y++) {
            for (let x = 1; x < aw - 1; x++) {
                const i = y * aw + x;
                if (!votes[i]) continue;
                let score = votes[i] * 2;
                score += votes[i - 1] + votes[i + 1] + votes[i - aw] + votes[i + aw];
                if (score < 8) continue;
                const cx = left + x * step, cy = top + y * step;
                const centerPreference = 1 - clamp(Number.isFinite(options.bias) ? options.bias : 0.6, 0, 1) * 0.12 * Math.min(1, Math.hypot(cx - width / 2, cy - height / 2) / (size * 0.7));
                peaks.push({ x: cx, y: cy, vote: score * centerPreference });
            }
        }
        peaks.sort((a, b) => b.vote - a.vote);
        const centers = [];
        for (const peak of peaks) {
            if (centers.every(other => Math.hypot(other.x - peak.x, other.y - peak.y) > Math.max(4, size / 55))) centers.push(peak);
            if (centers.length >= 18) break;
        }
        if (options.prior && Number.isFinite(options.prior.x) && Number.isFinite(options.prior.y) && Number.isFinite(options.prior.r) && options.prior.r > 0) {
            centers.unshift({ x: options.prior.x, y: options.prior.y, vote: 0, priorRadius: options.prior.r });
        }
        const circles = [];
        for (const center of centers) {
            const bins = new Float32Array(Math.ceil(maxR) + 3);
            for (const edge of edges) {
                const dx = edge.x - center.x, dy = edge.y - center.y;
                const radius = Math.hypot(dx, dy);
                if (radius < minR || radius > maxR || Math.abs((dx * edge.nx + dy * edge.ny) / radius) < 0.87) continue;
                bins[Math.round(radius)] += edge.weight;
            }
            const radii = [];
            for (let radius = Math.ceil(minR); radius < maxR - 2; radius++) {
                const support = bins[radius - 1] + bins[radius] + bins[radius + 1];
                if (support < 8) continue;
                // Normalize for circumference so a large clutter ring does not
                // automatically win simply because it has more edge pixels.
                radii.push({ r: radius, strength: support / Math.sqrt(radius) });
            }
            radii.sort((a, b) => b.strength - a.strength);
            const chosen = [];
            for (const radius of radii) {
                if (chosen.every(other => Math.abs(other.r - radius.r) > Math.max(5, radius.r * 0.04))) chosen.push(radius);
                if (chosen.length >= 3) break;
            }
            if (center.priorRadius) chosen.unshift({ r: center.priorRadius, strength: 0 });
            for (const radius of chosen) circles.push({ x: center.x, y: center.y, r: radius.r, proposalStrength: radius.strength,
                fromPrior: Boolean(center.priorRadius && radius.r === center.priorRadius) });
        }
        // Reserve a bounded proposal slot for an explicitly requested manual
        // estimate, even when dozens of stronger clutter votes precede it.
        circles.sort((a, b) => Number(b.fromPrior) - Number(a.fromPrior) || b.proposalStrength - a.proposalStrength);
        return circles.slice(0, 48);
    }

    function rimPoints(data, circle, band, samples, thresholdMultiplier) {
        const points = [];
        const visible = new Uint8Array(samples);
        const support = new Uint8Array(samples);
        const radialStep = Math.max(0.5, band / 14);
        for (let i = 0; i < samples; i++) {
            const angle = i / samples * TAU;
            const nx = Math.cos(angle), ny = Math.sin(angle);
            const px = circle.x + nx * circle.r, py = circle.y + ny * circle.r;
            if (px < 2 || py < 2 || px >= data.width - 2 || py >= data.height - 2) continue;
            visible[i] = 1;
            let best = null;
            for (let delta = -band; delta <= band + radialStep * 0.1; delta += radialStep) {
                const x = circle.x + nx * (circle.r + delta), y = circle.y + ny * (circle.r + delta);
                const dx = sample(data.gx, data, x, y), dy = sample(data.gy, data, x, y);
                const mag = Math.hypot(dx, dy);
                const aligned = Math.abs(dx * nx + dy * ny) / Math.max(0.001, mag);
                if (mag < data.threshold * thresholdMultiplier || aligned < 0.9) continue;
                const strength = mag * aligned * aligned / (1 + Math.abs(delta) / Math.max(2, band) * 0.16);
                if (!best || strength > best.strength) best = { x, y, angle, index: i, strength, magnitude: mag, delta, aligned };
            }
            if (best) { points.push(best); support[i] = 1; }
        }
        return { points, visible, support };
    }

    function solve3(matrix, vector) {
        const a = matrix.map((row, index) => row.concat(vector[index]));
        for (let column = 0; column < 3; column++) {
            let pivot = column;
            for (let row = column + 1; row < 3; row++) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
            if (Math.abs(a[pivot][column]) < 1e-8) return null;
            [a[column], a[pivot]] = [a[pivot], a[column]];
            const scale = a[column][column];
            for (let j = column; j < 4; j++) a[column][j] /= scale;
            for (let row = 0; row < 3; row++) {
                if (row === column) continue;
                const factor = a[row][column];
                for (let j = column; j < 4; j++) a[row][j] -= factor * a[column][j];
            }
        }
        return a.map(row => row[3]);
    }

    function fit(points, initial, iterations) {
        const circle = { x: initial.x, y: initial.y, r: initial.r };
        for (let iteration = 0; iteration < iterations; iteration++) {
            const errors = points.map(point => Math.hypot(point.x - circle.x, point.y - circle.y) - circle.r);
            const robustScale = Math.max(0.45, median(errors.map(Math.abs)) * 1.4826);
            const matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], vector = [0, 0, 0];
            for (let i = 0; i < points.length; i++) {
                const point = points[i], dx = circle.x - point.x, dy = circle.y - point.y;
                const distance = Math.hypot(dx, dy);
                if (distance < 1e-4) continue;
                const error = errors[i], normalized = error / (robustScale * 3);
                if (Math.abs(normalized) >= 1) continue;
                const weight = (1 - normalized * normalized) ** 2;
                const jacobian = [dx / distance, dy / distance, -1];
                for (let row = 0; row < 3; row++) {
                    vector[row] -= weight * jacobian[row] * error;
                    for (let column = 0; column < 3; column++) matrix[row][column] += weight * jacobian[row] * jacobian[column];
                }
            }
            const delta = solve3(matrix, vector);
            if (!delta || delta.some(value => !Number.isFinite(value))) return null;
            const limit = Math.max(2, circle.r * 0.06);
            circle.x += clamp(delta[0], -limit, limit);
            circle.y += clamp(delta[1], -limit, limit);
            circle.r += clamp(delta[2], -limit, limit);
            if (Math.hypot(...delta) < 0.005) break;
        }
        return circle.r > 5 ? circle : null;
    }

    function circleFromThree(a, b, c) {
        const bx = b.x - a.x, by = b.y - a.y, cx = c.x - a.x, cy = c.y - a.y;
        const denominator = 2 * (bx * cy - by * cx);
        if (Math.abs(denominator) < 1) return null;
        const b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
        const dx = (cy * b2 - by * c2) / denominator, dy = (bx * c2 - cx * b2) / denominator;
        return { x: a.x + dx, y: a.y + dy, r: Math.hypot(dx, dy) };
    }

    function ransac(points, initial) {
        if (points.length < 12) return null;
        let state = 0x6d2b79f5;
        const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
        const tolerance = Math.max(1, initial.r * 0.009);
        let best = initial, bestScore = -1;
        for (let trial = -1; trial < 90; trial++) {
            const circle = trial < 0 ? initial : circleFromThree(points[Math.floor(random() * points.length)], points[Math.floor(random() * points.length)], points[Math.floor(random() * points.length)]);
            if (!circle || Math.abs(circle.r - initial.r) > Math.max(6, initial.r * 0.12) ||
                Math.hypot(circle.x - initial.x, circle.y - initial.y) > Math.max(8, initial.r * 0.14)) continue;
            let score = 0;
            for (const point of points) {
                const error = Math.abs(Math.hypot(point.x - circle.x, point.y - circle.y) - circle.r);
                if (error < tolerance) score += 1 - (error / tolerance) ** 2;
            }
            if (score > bestScore) { bestScore = score; best = circle; }
        }
        const inliers = points.filter(point => Math.abs(Math.hypot(point.x - best.x, point.y - best.y) - best.r) < tolerance * 1.8);
        return inliers.length >= 12 ? fit(inliers, best, 7) : null;
    }

    function assess(data, circle, options) {
        const samples = 180;
        const tolerance = Math.max(1.1, Math.min(2.1, circle.r * 0.008));
        const rim = rimPoints(data, circle, tolerance, samples, 1);
        const points = rim.points;
        const visibleCount = rim.visible.reduce((sum, value) => sum + value, 0);
        if (points.length < 35 || visibleCount < 40) return null;
        const errors = points.map(point => Math.abs(Math.hypot(point.x - circle.x, point.y - circle.y) - circle.r));
        const inliers = points.filter((point, index) => errors[index] <= tolerance * 0.82);
        const supported = new Uint8Array(samples);
        for (const point of inliers) supported[point.index] = 1;
        const coverage = inliers.length / visibleCount;
        const visibleFraction = visibleCount / samples;
        // Reject long but disconnected collections of accidental intersections.
        let neighbours = 0;
        for (let i = 0; i < samples; i++) if (supported[i] && (supported[(i + 1) % samples] || supported[(i + samples - 1) % samples])) neighbours++;
        const continuity = neighbours / Math.max(1, inliers.length);
        let longestGap = 0, gap = 0;
        for (let i = 0; i < samples * 2; i++) {
            if (supported[i % samples]) gap = 0;
            else { gap++; longestGap = Math.max(longestGap, Math.min(samples, gap)); }
        }
        const angularSpan = (samples - longestGap) / samples * 360;
        const residual = Math.sqrt(inliers.reduce((sum, point) => sum + (Math.hypot(point.x - circle.x, point.y - circle.y) - circle.r) ** 2, 0) / Math.max(1, inliers.length));
        const alignment = inliers.reduce((sum, point) => sum + point.aligned, 0) / Math.max(1, inliers.length);
        const minCoverage = options.minCoverage ?? 0.66;
        if (coverage < minCoverage || continuity < 0.88 || angularSpan < 155 || inliers.length / samples < 0.36 ||
            residual > Math.max(0.82, circle.r * 0.006) || alignment < 0.955) return null;
        // Circle fit residual must also be low in several separate rim regions.
        // A robust fit alone could otherwise explain just two sides of an ellipse.
        const quadrants = [0, 0, 0, 0, 0, 0, 0, 0];
        for (const point of inliers) quadrants[Math.floor(point.index / samples * 8)]++;
        if (quadrants.filter(value => value >= 4).length < (visibleFraction < 0.65 ? 4 : 5)) return null;
        const precision = Math.exp(-residual / Math.max(0.65, circle.r * 0.007));
        const spanQuality = clamp(angularSpan / 240, 0.65, 1);
        const confidence = clamp(coverage * 0.46 + continuity * 0.18 + alignment * 0.12 + precision * 0.16 + spanQuality * 0.08, 0, 1);
        const sizeQuality = 0.86 + 0.14 * clamp(circle.r / (Math.min(data.width, data.height) * 0.35), 0, 1);
        const score = confidence * (0.8 + 0.2 * Math.sqrt(inliers.length / samples)) * sizeQuality;
        return { x: circle.x, y: circle.y, r: circle.r, score, confidence, coverage, visibleFraction, residual, angularSpan, continuity, alignment, support: inliers.length };
    }

    function refineField(data, candidate, options) {
        if (!candidate || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y) || !Number.isFinite(candidate.r) || candidate.r < 6) return null;
        let circle = { x: candidate.x, y: candidate.y, r: candidate.r };
        const band = clamp(options.band ?? Math.max(5, candidate.r * 0.04), 2, Math.max(5, candidate.r * 0.16));
        const iterations = clamp(options.maxIterations ?? 4, 1, 6);
        for (let iteration = 0; iteration < iterations; iteration++) {
            const currentBand = iteration ? Math.max(2.3, band * 0.45) : band;
            const rim = rimPoints(data, circle, currentBand, 180, 0.85);
            if (rim.points.length < 35) return null;
            const next = iteration === 0 ? ransac(rim.points, circle) : fit(rim.points, circle, 6);
            if (!next || Math.hypot(next.x - candidate.x, next.y - candidate.y) > band * 2.2 || Math.abs(next.r - candidate.r) > band * 2.2) return null;
            circle = next;
        }
        return assess(data, circle, options);
    }

    function sameCircle(a, b) {
        const tolerance = Math.max(3, Math.min(a.r, b.r) * 0.045);
        return Math.hypot(a.x - b.x, a.y - b.y) < tolerance && Math.abs(a.r - b.r) < tolerance;
    }

    function select(input, options) {
        options = options || {};
        const candidates = [];
        for (const circle of input || []) {
            if (!circle || !Number.isFinite(circle.score) || !Number.isFinite(circle.x) || !Number.isFinite(circle.y) || !(circle.r > 0)) continue;
            const existing = candidates.findIndex(other => sameCircle(other, circle));
            if (existing < 0) candidates.push(circle);
            else if (circle.score > candidates[existing].score) candidates[existing] = circle;
        }
        candidates.sort((a, b) => b.score - a.score);
        if (!candidates.length) return { candidates, best: null, reason: 'uncertain' };
        // The prior is an explicit caller preference, never evidence of a rim.
        // It may distinguish already accepted alternatives near the manual fit.
        const prior = options.prior;
        if (prior && Number.isFinite(prior.x) && Number.isFinite(prior.y) && prior.r > 0) {
            const nearby = candidates.filter(circle => Math.hypot(circle.x - prior.x, circle.y - prior.y) / circle.r < 0.3 &&
                Math.abs(circle.r - prior.r) / circle.r < 0.2 && circle.score >= candidates[0].score * 0.85);
            if (nearby.length === 1) return { candidates: candidates.slice(0, 8), best: nearby[0], reason: 'aligned-prior' };
        }
        // Confidence is evidence quality, not a calibrated probability. Distinct
        // similarly strong circles require a manual choice rather than guessing.
        const first = candidates[0];
        const ambiguous = candidates.slice(1).some(other => other.score >= first.score * 0.955 && other.coverage >= first.coverage - 0.06);
        return { candidates: candidates.slice(0, 8), best: ambiguous ? null : first, reason: ambiguous ? 'ambiguous' : 'aligned' };
    }

    function analyze(pixels, width, height, options) {
        options = Object.assign({ sensitivity: 0.25, bias: 0.6 }, options);
        const data = field(pixels, width, height, options.sensitivity);
        if (!data) return { candidates: [], best: null, reason: 'no-edges' };
        const edges = edgePoints(data);
        if (edges.length < 35) return { candidates: [], best: null, reason: 'no-edges' };
        const initial = proposals(data, edges, options);
        const candidates = [];
        for (const proposal of initial) {
            const refined = refineField(data, proposal, options);
            if (!refined) continue;
            const existing = candidates.findIndex(other => sameCircle(other, refined));
            if (existing < 0) candidates.push(refined);
            else if (refined.score > candidates[existing].score) candidates[existing] = refined;
        }
        return select(candidates, options);
    }

    function refine(pixels, width, height, candidate, options) {
        options = Object.assign({ sensitivity: 0.25 }, options);
        const data = field(pixels, width, height, options.sensitivity);
        return data ? refineField(data, candidate, options) : null;
    }

    function refineMany(pixels, width, height, candidates, options) {
        options = Object.assign({ sensitivity: 0.25 }, options);
        const data = field(pixels, width, height, options.sensitivity);
        if (!data || !Array.isArray(candidates)) return [];
        // The UI submits at most four. Also bound work for independent callers.
        const results = [];
        for (const candidate of candidates.slice(0, 8)) {
            const result = refineField(data, candidate, options);
            if (result) results.push(result);
        }
        return results;
    }

    function detectCircle(pixels, width, height, sensitivity, bias) {
        return analyze(pixels, width, height, { sensitivity, bias }).best;
    }

    return { analyze, refine, refineMany, detectCircle, select };
});
