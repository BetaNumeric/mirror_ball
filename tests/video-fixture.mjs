// Serialized into the browser by the regression harness; no Node dependencies.
export async function createVideoFixture({ width = 128, height = 128, count = 10, fps = 10, draw, name = 'colors.webm' } = {}) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'), frames = [];
    const encoder = new VideoEncoder({ output(chunk) { const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes); frames.push({ bytes, timestamp: chunk.timestamp }); }, error(error) { throw error; } });
    encoder.configure({ codec: 'vp8', width, height, bitrate: 500000, framerate: fps, latencyMode: 'realtime' });
    for (let i = 0; i < count; i++) {
        if (draw) draw(ctx, i);
        else { ctx.fillStyle = i < count / 2 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, width, height); }
        const frame = new VideoFrame(canvas, { timestamp: Math.round(i / fps * 1000000), duration: Math.round(1000000 / fps) });
        encoder.encode(frame, { keyFrame: true }); frame.close();
    }
    await encoder.flush(); encoder.close();
    const concat = parts => { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; };
    const integer = value => { const bytes = []; do { bytes.unshift(value & 255); value = Math.floor(value / 256); } while (value); return new Uint8Array(bytes); };
    const size = value => { let length = 1; while (value >= 2 ** (7 * length) - 1) length++; let encoded = BigInt(value) | (1n << BigInt(7 * length)); const bytes = new Uint8Array(length); for (let i = length - 1; i >= 0; i--) { bytes[i] = Number(encoded & 255n); encoded >>= 8n; } return bytes; };
    const text = value => new TextEncoder().encode(value);
    const element = (id, data) => concat([new Uint8Array(id.match(/../g).map(byte => parseInt(byte, 16))), size(data.length), data]);
    const number = (id, value) => element(id, integer(value));
    const duration = new Uint8Array(8); new DataView(duration.buffer).setFloat64(0, count / fps * 1000);
    const header = element('1a45dfa3', concat([number('4286', 1), number('42f7', 1), number('42f2', 4), number('42f3', 8), element('4282', text('webm')), number('4287', 4), number('4285', 2)]));
    const info = element('1549a966', concat([number('2ad7b1', 1000000), element('4489', duration), element('4d80', text('Mirror Ball tests')), element('5741', text('Mirror Ball tests'))]));
    const track = element('1654ae6b', element('ae', concat([number('d7', 1), number('73c5', 1), number('83', 1), element('86', text('V_VP8')), number('23e383', Math.round(1000000000 / fps)), element('e0', concat([number('b0', width), number('ba', height)]))])));
    const blocks = frames.map(frame => { const prefix = new Uint8Array([0x81, 0, 0, 0x80]); new DataView(prefix.buffer).setInt16(1, frame.timestamp / 1000); return element('a3', concat([prefix, frame.bytes])); });
    const cluster = element('1f43b675', concat([number('e7', 0), ...blocks]));
    return new File([header, element('18538067', concat([info, track, cluster]))], name, { type: 'video/webm' });
}
