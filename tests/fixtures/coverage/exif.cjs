'use strict';

function exifSegment({ focalLength35mm = 140, focalLength = 70, width = 5184, height = 3888, orientation = 1, digitalZoom = 0, little = true } = {}) {
    const tiff = Buffer.alloc(128);
    const u16 = (offset, value) => little ? tiff.writeUInt16LE(value, offset) : tiff.writeUInt16BE(value, offset);
    const u32 = (offset, value) => little ? tiff.writeUInt32LE(value, offset) : tiff.writeUInt32BE(value, offset);
    const entry = (offset, tag, type, value) => {
        u16(offset, tag); u16(offset + 2, type); u32(offset + 4, 1);
        if (type === 3) u16(offset + 8, value); else u32(offset + 8, value);
    };
    tiff.write(little ? 'II' : 'MM', 0, 'ascii'); u16(2, 42); u32(4, 8);
    u16(8, 2); entry(10, 0x0112, 3, orientation); entry(22, 0x8769, 4, 38);
    u16(38, 5);
    entry(40, 0xa405, 3, focalLength35mm); entry(52, 0x920a, 5, 104);
    entry(64, 0xa002, 4, width); entry(76, 0xa003, 4, height); entry(88, 0xa404, 5, 112);
    u32(104, Math.round(focalLength * 100)); u32(108, 100);
    u32(112, Math.round(digitalZoom * 100)); u32(116, 100);
    const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
    const header = Buffer.from([0xff, 0xe1, 0, 0]); header.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([header, payload]);
}

function jpegWithExif(options = {}, { width = options.width ?? 5184, height = options.height ?? 3888 } = {}) {
    const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
    sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), exifSegment(options), sof, Buffer.from([0xff, 0xd9])]);
}

module.exports = { exifSegment, jpegWithExif };
