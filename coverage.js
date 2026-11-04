/* Reflective-sphere coverage and bounded JPEG metadata reading. */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MirrorBallCoverage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const FULL_FRAME_DIAGONAL = Math.hypot(36, 24);
    const degrees = radians => radians * 180 / Math.PI;
    const positive = value => Number.isFinite(value) && value > 0;
    const result = (halfAngle, source) => {
        const blindSpot = degrees(halfAngle) * 2;
        return { coverage: 360 - blindSpot, blindSpot, source };
    };

    function fromGeometry(diameter, distance) {
        if (!positive(diameter) || !positive(distance)) return { reason: 'geometry-required' };
        // Distance is from the camera's viewpoint to the sphere centre.
        const radius = diameter / 2;
        if (distance <= radius) return { reason: 'camera-inside-ball' };
        return result(Math.asin(radius / distance), 'geometry');
    }

    function fromFocalLength(radius, width, height, focalLength35mm) {
        if (![radius, width, height].every(positive)) return { reason: 'circle-required' };
        if (!positive(focalLength35mm)) return { reason: 'focal-required' };
        const focalPixels = focalLength35mm / FULL_FRAME_DIAGONAL * Math.hypot(width, height);
        // Rectilinear, uncropped image; circular silhouette close to the optical axis.
        return result(Math.atan(radius / focalPixels), 'lens');
    }

    function estimate({ mode, metadata, radius, width, height, focalLength35mm, diameter, distance }) {
        if (mode === 'geometry') return fromGeometry(diameter, distance);
        if (mode === 'lens') return fromFocalLength(radius, width, height, focalLength35mm);
        if (!metadata || !positive(metadata.focalLength35mm)) return { reason: 'metadata-required' };
        if (metadata.digitalZoom > 1) return { reason: 'digital-zoom' };
        if (metadata.width && metadata.height && metadata.encodedWidth && metadata.encodedHeight) {
            const same = metadata.width === metadata.encodedWidth && metadata.height === metadata.encodedHeight;
            const swapped = metadata.width === metadata.encodedHeight && metadata.height === metadata.encodedWidth;
            if (!same && !swapped) return { reason: 'edited-dimensions' };
        }
        const estimated = fromFocalLength(radius, width, height, metadata.focalLength35mm);
        return estimated.reason ? estimated : { ...estimated, source: 'metadata' };
    }

    function parseTiff(bytes) {
        if (bytes.length < 8) return null;
        const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const little = data.getUint16(0) === 0x4949;
        if (!little && data.getUint16(0) !== 0x4d4d || data.getUint16(2, little) !== 42) return null;
        const u16 = offset => data.getUint16(offset, little);
        const u32 = offset => data.getUint32(offset, little);
        const tags = { 0x920a: 'focalLength', 0xa405: 'focalLength35mm', 0xa404: 'digitalZoom', 0xa002: 'width', 0xa003: 'height', 0x0112: 'orientation' };
        const sizes = { 3: 2, 4: 4, 5: 8 };
        const seen = new Set(), metadata = {};
        const read = (offset, depth) => {
            if (depth > 1 || seen.has(offset) || offset < 8 || offset + 2 > bytes.length) return;
            seen.add(offset);
            const count = u16(offset);
            if (count > 256 || offset + 2 + count * 12 > bytes.length) return;
            for (let i = 0; i < count; i++) {
                const entry = offset + 2 + i * 12, tag = u16(entry), type = u16(entry + 2), count = u32(entry + 4);
                if (tag === 0x8769 && type === 4 && count === 1) { read(u32(entry + 8), depth + 1); continue; }
                if (!tags[tag] || count !== 1 || !sizes[type]) continue;
                const p = sizes[type] > 4 ? u32(entry + 8) : entry + 8;
                if (p + sizes[type] > bytes.length) continue;
                const value = type === 3 ? u16(p) : type === 4 ? u32(p) : u32(p + 4) ? u32(p) / u32(p + 4) : NaN;
                if (Number.isFinite(value)) metadata[tags[tag]] = value;
            }
        };
        read(u32(4), 0);
        return Object.keys(metadata).length ? metadata : null;
    }

    function parseJpegExif(input) {
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
        if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
        let offset = 2, metadata = null, encodedWidth, encodedHeight;
        while (offset + 4 <= bytes.length) {
            if (bytes[offset++] !== 0xff) break;
            while (bytes[offset] === 0xff) offset++;
            const marker = bytes[offset++];
            if (marker === 0xda || marker === 0xd9) break;
            if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) continue;
            const size = bytes[offset] * 256 + bytes[offset + 1];
            if (size < 2 || offset + size > bytes.length) break;
            const start = offset + 2;
            if (marker === 0xe1 && size >= 16 && bytes[start] === 0x45 && bytes[start + 1] === 0x78 &&
                bytes[start + 2] === 0x69 && bytes[start + 3] === 0x66 && bytes[start + 4] === 0 && bytes[start + 5] === 0) {
                metadata = metadata || parseTiff(bytes.subarray(start + 6, offset + size));
            }
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 8) {
                encodedHeight = bytes[start + 1] * 256 + bytes[start + 2];
                encodedWidth = bytes[start + 3] * 256 + bytes[start + 4];
            }
            offset += size;
        }
        return metadata ? { ...metadata, encodedWidth, encodedHeight } : null;
    }

    async function readJpegExif(file) {
        // Never read a whole video or unbounded metadata into memory.
        if (!file || typeof file.slice !== 'function') return null;
        try {
            return parseJpegExif(await file.slice(0, 1024 * 1024).arrayBuffer());
        } catch { return null; }
    }

    return { estimate, fromGeometry, fromFocalLength, parseJpegExif, readJpegExif };
});
