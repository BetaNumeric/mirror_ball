// Run with Node.js 22+ and Chrome/Chromium: node tests/browser-regressions.mjs
// Set CHROME_PATH if the browser is installed elsewhere.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCorrectnessChecks } from './correctness-checks.mjs';
import { runInteractionChecks } from './interaction-checks.mjs';
import { runWorkspaceChecks } from './workspace-checks.mjs';
import { runAutoAlignBrowserChecks } from './auto-align-browser-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(candidate => candidate && existsSync(candidate));
assert.ok(chromePath, 'Install Chrome/Chromium or set CHROME_PATH.');
const profile = mkdtempSync(join(tmpdir(), 'mirror-ball-test-'));
const nativeVideoPath = join(profile, 'colors.webm');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !['/index.html', '/', '/auto-align.js', '/example/example.jpg'].includes(pathname)) {
        res.writeHead(404).end();
        return;
    }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'image/jpeg');
    res.end(readFileSync(file));
});
let browser, socket, requestId = 0, checksPassed = 0;
const pending = new Map(), exceptions = [];
function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = ++requestId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
        pending.set(id, {
            resolve: result => { clearTimeout(timer); resolve(result); },
            reject: error => { clearTimeout(timer); reject(error); }
        });
        socket.send(JSON.stringify({ id, method, params }));
    });
}
async function evaluate(expression) {
    const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
}
async function waitFor(expression) {
    for (let attempt = 0; attempt < 150; attempt++) {
        if (await evaluate(expression)) return;
        await delay(100);
    }
    const mediaState = await evaluate("({ isVideo, isWebcam, source: sourceMedia?.tagName, readyState: sourceVideoHidden.readyState, networkState: sourceVideoHidden.networkState, error: sourceVideoHidden.error?.message, currentSrc: sourceVideoHidden.currentSrc, selectedFile: fileInput.files[0]?.name, toast: toastContainer.lastElementChild?.innerText })");
    throw new Error(`Timed out waiting for ${expression}: ${JSON.stringify(mediaState)}`);
}
async function check(name, expression) {
    assert.equal(await evaluate(expression), true, name);
    checksPassed++;
    console.log(`PASS ${name}`);
}
async function loadImage() {
    await evaluate(`(async () => {
        const blob = await (await fetch('/example/example.jpg')).blob();
        handleFileSelect(new File([blob], 'example.jpg', { type: 'image/jpeg' }));
        return true;
    })()`);
    await waitFor("sourceMedia?.tagName === 'IMG'");
}
async function loadVideo(path = nativeVideoPath) {
    const document = await cdp('DOM.getDocument');
    const input = await cdp('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#fileInput' });
    await evaluate("fileInput.value = ''; true;");
    await cdp('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [path] });
    await waitFor('isVideo && sourceVideoHidden.readyState >= 2');
}

try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0',
        `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
        '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', 'about:blank'
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '', launchError;
    browser.stderr.on('data', chunk => stderr += chunk);
    browser.on('error', error => launchError = error);
    for (let attempt = 0; attempt < 100 && !stderr.includes('DevTools listening on') && !launchError; attempt++) await delay(100);
    if (launchError) throw launchError;
    const endpoint = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
    assert.ok(endpoint, `Chrome failed to start: ${stderr.slice(-1500)}`);
    const targets = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const request = pending.get(message.id);
            if (!request) return;
            pending.delete(message.id);
            if (message.error) request.reject(new Error(JSON.stringify(message.error)));
            else request.resolve(message.result);
        } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    };
    socket.onclose = () => { for (const request of pending.values()) request.reject(new Error('Chrome disconnected')); pending.clear(); };
    await cdp('Runtime.enable');
    await cdp('Page.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await waitFor("document.readyState === 'complete' && typeof procCanvas !== 'undefined'");
    await evaluate('maxTextureSize = 256; true;');
    await check('adjusting before import does not initialize a hidden preview', `(() => {
        fovSlider.dispatchEvent(new Event('input'));
        return !renderer && getComputedStyle(viewerSection).display === 'none';
    })()`);
    await loadImage();
    await check('image import initializes a visible preview with a valid aspect',
        'renderer.domElement.width > 0 && renderer.domElement.height > 0 && Number.isFinite(camera.aspect)');
    await check('the bundled photo supplies a supported alignment through the real worker', `(async () => {
        return await runAutoDetect() === true && [ball.x, ball.y, ball.r].every(Number.isFinite) && ball.r > 0 && !autoAlignJob;
    })()`);
    await check('output widths stay positive, even, and within the GPU limit', `(() => {
        for (const value of ['-5', '0', '1', '3', '129', '999999999', '']) {
            widthInput.value = value; updateParams();
            if (procCanvas.width < 2 || procCanvas.width % 2 || procCanvas.width > 256 || procCanvas.height !== procCanvas.width / 2) return false;
        }
        widthInput.value = 256; updateParams(); return true;
    })()`);
    await delay(200);
    await check('an idle preview does not upload the same texture repeatedly', `(async () => {
        const before = sphereMesh.material.map.version;
        await new Promise(resolve => setTimeout(resolve, 100));
        return sphereMesh.material.map.version === before;
    })()`);
    await evaluate(`window.originalAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
            window.imageDownload = { name: this.download, blob: fetch(this.href).then(response => response.blob()) };
        }; true;`);
    for (const format of ['jpg', 'png']) {
        await evaluate(`window.imageDownload = null; formatSelect.value = '${format}'; downloadBtn.click(); true;`);
        await waitFor('window.imageDownload !== null');
        await check(`${format.toUpperCase()} still export uses the selected format`, `(async () => {
            const blob = await window.imageDownload.blob;
            return window.imageDownload.name === 'equirectangular.${format}' && blob.type === '${format === 'jpg' ? 'image/jpeg' : 'image/png'}';
        })()`);
    }
    await evaluate('HTMLAnchorElement.prototype.click = window.originalAnchorClick; true;');
    await runCorrectnessChecks({ evaluate, check, waitFor, loadImage });
    await runAutoAlignBrowserChecks({ cdp, evaluate, check, waitFor, loadImage, delay });
    await runInteractionChecks({ cdp, evaluate, check, waitFor, loadImage, delay });
    await runWorkspaceChecks({ cdp, evaluate, check, waitFor, loadImage, delay });

    // Encode a deterministic red/blue VP8 clip and mux it into a minimal WebM.
    await evaluate(`(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
        const ctx = canvas.getContext('2d'), frames = [];
        const encoder = new VideoEncoder({ output(chunk) { const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes); frames.push({ bytes, timestamp: chunk.timestamp }); }, error(error) { throw error; } });
        encoder.configure({ codec: 'vp8', width: 128, height: 128, bitrate: 100000, framerate: 10, latencyMode: 'realtime' });
        for (let i = 0; i < 10; i++) {
            ctx.fillStyle = i < 5 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, 128, 128);
            const frame = new VideoFrame(canvas, { timestamp: i * 100000, duration: 100000 });
            encoder.encode(frame, { keyFrame: true }); frame.close();
        }
        await encoder.flush(); encoder.close();
        const concat = parts => { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; };
        const integer = value => { const bytes = []; do { bytes.unshift(value & 255); value = Math.floor(value / 256); } while (value); return new Uint8Array(bytes); };
        const size = value => { let length = 1; while (value >= 2 ** (7 * length) - 1) length++; let encoded = BigInt(value) | (1n << BigInt(7 * length)); const bytes = new Uint8Array(length); for (let i = length - 1; i >= 0; i--) { bytes[i] = Number(encoded & 255n); encoded >>= 8n; } return bytes; };
        const text = value => new TextEncoder().encode(value);
        const element = (id, data) => concat([new Uint8Array(id.match(/../g).map(byte => parseInt(byte, 16))), size(data.length), data]);
        const number = (id, value) => element(id, integer(value));
        const duration = new Uint8Array(8); new DataView(duration.buffer).setFloat64(0, 1000);
        const header = element('1a45dfa3', concat([number('4286', 1), number('42f7', 1), number('42f2', 4), number('42f3', 8), element('4282', text('webm')), number('4287', 4), number('4285', 2)]));
        const info = element('1549a966', concat([number('2ad7b1', 1000000), element('4489', duration), element('4d80', text('Mirror Ball tests')), element('5741', text('Mirror Ball tests'))]));
        const track = element('1654ae6b', element('ae', concat([number('d7', 1), number('73c5', 1), number('83', 1), element('86', text('V_VP8')), number('23e383', 100000000), element('e0', concat([number('b0', 128), number('ba', 128)]))])));
        const blocks = frames.map(frame => { const prefix = new Uint8Array([0x81, 0, 0, 0x80]); new DataView(prefix.buffer).setInt16(1, frame.timestamp / 1000); return element('a3', concat([prefix, frame.bytes])); });
        const cluster = element('1f43b675', concat([number('e7', 0), ...blocks]));
        window.testVideoFile = new File([header, element('18538067', concat([info, track, cluster]))], 'colors.webm', { type: 'video/webm' }); return true;
    })()`);
    const videoBytes = await evaluate('(async () => Array.from(new Uint8Array(await window.testVideoFile.arrayBuffer())))()');
    writeFileSync(nativeVideoPath, Buffer.from(videoBytes));
    await evaluate(`window.metadataState = null;
        sourceVideoHidden.addEventListener('loadedmetadata', () => {
            Object.defineProperty(sourceVideoHidden, 'readyState', { configurable: true, value: 1 });
            setTimeout(() => {
                window.metadataState = { initialized: isVideo, controlsVisible: !videoControls.classList.contains('hidden') };
                renderProcessor(); drawUI();
                delete sourceVideoHidden.readyState;
            }, 0);
        }, { once: true, capture: true });
        for (const event of ['loadeddata', 'canplay']) {
            sourceVideoHidden.addEventListener(event, event => event.stopImmediatePropagation(), { once: true, capture: true });
        }
        true;`);
    await loadVideo();
    await check('video controls initialize even when first-frame events are delayed or absent',
        'window.metadataState.initialized && window.metadataState.controlsVisible && isVideo');
    await check('the native file picker retains the selected video and filename',
        "fileInput.files.length === 1 && fileInput.files[0].name === 'colors.webm'");
    await check('video import starts paused at frame zero with a finite duration',
        'sourceVideoHidden.paused && sourceVideoHidden.currentTime === 0 && sourceVideoHidden.duration === 1');
    await check('a video selected through the native file picker plays and advances', `(async () => {
        await toggleVideoPlayback();
        await new Promise(resolve => setTimeout(resolve, 200));
        await toggleVideoPlayback();
        return sourceVideoHidden.currentTime > 0 && sourceVideoHidden.paused;
    })()`);
    await delay(200);
    await check('seeking a paused video refreshes its output and texture', `(async () => {
        const before = procCanvas.toDataURL(), version = procTexture.version;
        await new Promise(resolve => { sourceVideoHidden.addEventListener('seeked', resolve, { once: true }); videoSeek.value = 75; videoSeek.dispatchEvent(new Event('input')); });
        await new Promise(resolve => setTimeout(resolve, 100));
        return sourceVideoHidden.paused && procTexture.version > version && procCanvas.toDataURL() !== before;
    })()`);
    await check('auto align leaves a paused video at the same frame', `(async () => {
        const time = sourceVideoHidden.currentTime, before = JSON.stringify(ball);
        const result = await runAutoDetect();
        return result === false && JSON.stringify(ball) === before && sourceVideoHidden.paused && sourceVideoHidden.currentTime === time && !autoAlignJob;
    })()`);
    await check('auto align captures video once and leaves playback running', `(async () => {
        await seekVideoFrame(sourceVideoHidden, 0, new AbortController().signal);
        await sourceVideoHidden.play();
        const original = CanvasRenderingContext2D.prototype.drawImage;
        let captures = 0;
        CanvasRenderingContext2D.prototype.drawImage = function (media, ...args) {
            if (media === sourceVideoHidden && this.canvas !== sourceCanvas) captures++;
            return original.call(this, media, ...args);
        };
        try {
            const time = sourceVideoHidden.currentTime;
            await runAutoDetect();
            return captures === 1 && !sourceVideoHidden.paused && sourceVideoHidden.currentTime >= time;
        } finally {
            CanvasRenderingContext2D.prototype.drawImage = original;
            sourceVideoHidden.pause();
        }
    })()`);
    await check('seeking cancels a pending alignment and settles its promise', `(async () => {
        const OriginalWorker = window.Worker;
        let terminated = false;
        window.Worker = class { postMessage() {} terminate() { terminated = true; } };
        try {
            const pending = runAutoDetect();
            videoSeek.value = 60; videoSeek.dispatchEvent(new Event('input'));
            return await pending === false && terminated && !autoAlignJob && autoDetectBtn.textContent === 'Auto align';
        } finally { window.Worker = OriginalWorker; }
    })()`);
    await evaluate(`(() => {
        const OriginalWorker = window.Worker;
        window.Worker = class { postMessage() {} terminate() { window.oldVideoAlignTerminated = true; } };
        window.oldVideoAlignTerminated = false;
        window.oldVideoAlignMedia = sourceMedia; window.oldVideoAlignId = mediaRequestId;
        window.oldVideoAlignment = runAutoDetect();
        window.Worker = OriginalWorker;
        return true;
    })()`);
    await loadVideo();
    await check('reusing the video element cancels alignment for its previous file', `(async () => {
        return await window.oldVideoAlignment === false && sourceMedia === window.oldVideoAlignMedia && mediaRequestId !== window.oldVideoAlignId && window.oldVideoAlignTerminated && !autoAlignJob;
    })()`);
    for (const fps of ['-25', '0', '', '121', '1e309']) {
        await check(`invalid FPS ${JSON.stringify(fps)} is rejected without locking controls`, `(async () => {
            fpsInput.value = '${fps}'; await startFrameExport();
            return !isExportingFrames && !fileInput.disabled && toastContainer.lastElementChild.innerText.includes('FPS');
        })()`);
    }
    await evaluate('window.savedArchives = []; window.saveAs = (blob, name) => window.savedArchives.push({ blob, name }); true;');
    await check('export from time zero completes and produces the expected frames', `(async () => {
        await seekVideoFrame(sourceVideoHidden, 0, new AbortController().signal);
        fpsInput.value = 5; formatSelect.value = 'jpg'; await startFrameExport();
        const saved = window.savedArchives[0]; if (!saved) return false;
        const zip = await JSZip.loadAsync(saved.blob), names = Object.keys(zip.files).filter(name => !zip.files[name].dir);
        const first = await zip.file(names[0]).async('uint8array');
        return names.length === 5 && names[4] === 'frames/frame_00004.jpg' && first[0] === 255 && first[1] === 216 && !isExportingFrames && !fileInput.disabled;
    })()`);
    await check('fractional FPS and PNG sequence export work', `(async () => {
        fpsInput.value = 2.5; formatSelect.value = 'png'; await startFrameExport();
        const zip = await JSZip.loadAsync(window.savedArchives[1].blob), names = Object.keys(zip.files).filter(name => !zip.files[name].dir);
        const first = await zip.file(names[0]).async('uint8array');
        return names.length === 3 && names[0].endsWith('.png') && first[0] === 137 && first[1] === 80;
    })()`);
    await evaluate(`window.originalToBlob = procCanvas.toBlob; window.pendingEncode = null;
        window.workerBeforeExport = window.Worker;
        window.Worker = class { postMessage() {} terminate() {} };
        window.alignmentBeforeExport = runAutoDetect();
        procCanvas.toBlob = function (...args) { window.pendingEncode = () => window.originalToBlob.apply(this, args); };
        window.exportPromise = startFrameExport();
        window.Worker = window.workerBeforeExport; true;`);
    await waitFor('window.pendingEncode !== null');
    await check('export locks media and optical controls while leaving Cancel available',
        "fileInput.disabled && webcamBtn.disabled && fovSlider.disabled && !exportFramesBtn.disabled && exportFramesBtn.innerText === 'Cancel Export'");
    await check('export cancels pending alignment before locking controls', `(async () => {
        return await window.alignmentBeforeExport === false && !autoAlignJob && autoDetectBtn.disabled && preferCircleToggle.disabled && autoDetectBtn.textContent === 'Auto align';
    })()`);
    await check('cancelling export prevents download and restores controls', `(async () => {
        exportFramesBtn.click(); window.pendingEncode(); await window.exportPromise;
        procCanvas.toBlob = window.originalToBlob;
        return window.savedArchives.length === 2 && !isExportingFrames && !fileInput.disabled && !autoDetectBtn.disabled && !preferCircleToggle.disabled && toastContainer.lastElementChild.innerText === 'Export cancelled.';
    })()`);
    await check('export refuses frames beyond its memory budget', `(async () => {
        procCanvas.toBlob = callback => callback({ size: MAX_EXPORT_BYTES + 1 });
        await startFrameExport(); procCanvas.toBlob = window.originalToBlob;
        return window.savedArchives.length === 2 && !isExportingFrames && !fileInput.disabled && toastContainer.lastElementChild.innerText.includes('256 MB');
    })()`);
    await check('cancelling during ZIP creation prevents saving the archive', `(async () => {
        const original = JSZip.prototype.generateAsync;
        JSZip.prototype.generateAsync = function (options, onUpdate) {
            return original.call(this, options, metadata => { exportController.abort(); onUpdate(metadata); });
        };
        try { await startFrameExport(); }
        finally { JSZip.prototype.generateAsync = original; }
        return window.savedArchives.length === 2 && !isExportingFrames && !fileInput.disabled && toastContainer.lastElementChild.innerText === 'Export cancelled.';
    })()`);
    await evaluate(`window.pendingEncode = null;
        procCanvas.toBlob = function (...args) { window.pendingEncode = () => window.originalToBlob.apply(this, args); };
        window.exportPromise = startFrameExport(); true;`);
    await waitFor('window.pendingEncode !== null');
    await loadImage();
    await check('replacing media aborts an in-progress export cleanly', `(async () => {
        window.pendingEncode(); await window.exportPromise; procCanvas.toBlob = window.originalToBlob;
        return window.savedArchives.length === 2 && !isExportingFrames && !fileInput.disabled && sourceMedia.tagName === 'IMG';
    })()`);
    await check('seek waits can be aborted', `(async () => {
        const video = new EventTarget(); Object.assign(video, { currentTime: 0, readyState: 2, seeking: false });
        const controller = new AbortController(), result = seekVideoFrame(video, 1, controller.signal);
        controller.abort(); try { await result; return false; } catch (error) { return error.name === 'AbortError'; }
    })()`);
    await check('failed seek operations reject instead of waiting forever', `(async () => {
        const video = new EventTarget(); Object.assign(video, { currentTime: 0, readyState: 2, seeking: false });
        const result = seekVideoFrame(video, 1, new AbortController().signal);
        video.dispatchEvent(new Event('error'));
        try { await result; return false; } catch (error) { return error.message.includes('Unable to read'); }
    })()`);
    await loadVideo();
    await evaluate('toggleWebcam(); true;');
    await waitFor('isWebcam && sourceVideoHidden.readyState >= 2');
    await check('video-to-webcam switches the export controls correctly',
        "!isVideo && exportFramesBtn.style.display === 'none' && fpsControl.classList.contains('hidden') && downloadBtn.style.display === 'flex'");
    await evaluate('window.oldCameraStream = sourceVideoHidden.srcObject; true;');
    await loadVideo();
    await check('webcam-to-video clears camera callbacks and stops the camera',
        "isVideo && !isWebcam && sourceVideoHidden.srcObject === null && sourceVideoHidden.onloadedmetadata === null && liveIndicator.classList.contains('hidden') && window.oldCameraStream.getTracks().every(track => track.readyState === 'ended')");
    for (const type of ['', 'application/octet-stream']) {
        await evaluate(`handleFileSelect(new File([window.testVideoFile], 'untyped.webm', { type: '${type}' })); true;`);
        await waitFor('isVideo && sourceVideoHidden.readyState >= 2');
        await check(`video filename fallback accepts MIME type ${JSON.stringify(type)}`,
            "isVideo && sourceMedia === sourceVideoHidden && !videoControls.classList.contains('hidden')");
    }
    await evaluate('sourceVideoHidden.play(); true;');
    await loadImage();
    await check('image import stops and unloads previous video playback',
        "!isVideo && !isWebcam && sourceVideoHidden.paused && !sourceVideoHidden.hasAttribute('src')");
    await check('a stale camera permission result cannot replace a newer file', `(async () => {
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        const stream = await original({ video: true });
        navigator.mediaDevices.getUserMedia = () => new Promise(resolve => window.resolveCamera = resolve);
        const pending = toggleWebcam();
        const image = new File([await (await fetch('/example/example.jpg')).blob()], 'image.jpg', { type: 'image/jpeg' });
        handleFileSelect(image); window.resolveCamera(stream); await pending;
        navigator.mediaDevices.getUserMedia = original;
        return !isWebcam && !webcamPending && stream.getTracks().every(track => track.readyState === 'ended');
    })()`);
    await waitFor("sourceMedia?.tagName === 'IMG'");
    await evaluate("handleFileSelect(new File(['invalid'], 'broken.mp4', { type: 'video/mp4' })); true;");
    await waitFor("toastContainer.lastElementChild?.innerText.includes('Unable to load this video')");
    await check('decode failures leave media controls in a recoverable state',
        "!sourceMedia && !isVideo && !isWebcam && !fileInput.disabled && exportFramesBtn.style.display === 'none'");
    if (process.env.MIRROR_BALL_TEST_VIDEO) {
        await evaluate('maxTextureSize = Number(widthInput.max); true;');
        await loadVideo(resolve(process.env.MIRROR_BALL_TEST_VIDEO));
        await check('the supplied video initializes at its full source dimensions',
            'sourceCanvas.width === sourceVideoHidden.videoWidth && sourceCanvas.height === sourceVideoHidden.videoHeight && procCanvas.width >= 2');
        await check('the supplied video plays in Chrome', `(async () => {
            await toggleVideoPlayback(); await new Promise(resolve => setTimeout(resolve, 1500)); await toggleVideoPlayback();
            return sourceVideoHidden.currentTime > 0 && sourceVideoHidden.paused;
        })()`);
        await check('the supplied video can seek while paused', `(async () => {
            await seekVideoFrame(sourceVideoHidden, sourceVideoHidden.duration / 2, new AbortController().signal);
            return sourceVideoHidden.paused && sourceVideoHidden.readyState >= 2;
        })()`);
        await check('supplied-video detection settles without changing a paused frame or uncertain alignment', `(async () => {
            const time = sourceVideoHidden.currentTime, before = JSON.stringify(ball);
            const aligned = await runAutoDetect();
            return !autoAlignJob && sourceVideoHidden.paused && sourceVideoHidden.currentTime === time
                && (aligned ? [ball.x, ball.y, ball.r].every(Number.isFinite) && ball.r > 0
                    : JSON.stringify(ball) === before && toastContainer.lastElementChild.textContent.includes('circle'));
        })()`);
    }
    // Local-file mode must load the companion module and self-contained Blob worker.
    const localFixturePath = join(profile, 'circle.png');
    const localFixture = await evaluate(`(() => {
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 384;
        const context = canvas.getContext('2d'); context.fillStyle = '#101010'; context.fillRect(0, 0, 512, 384);
        context.fillStyle = '#eee'; context.beginPath(); context.arc(250.4, 180.7, 130.3, 0, Math.PI * 2); context.fill();
        return canvas.toDataURL('image/png').split(',')[1];
    })()`);
    writeFileSync(localFixturePath, Buffer.from(localFixture, 'base64'));
    await cdp('Page.navigate', { url: pathToFileURL(join(root, 'index.html')).href });
    await waitFor("document.readyState === 'complete' && typeof procCanvas !== 'undefined' && typeof MirrorBallAlign !== 'undefined'");
    await evaluate('maxTextureSize = 256; true;');
    const localDocument = await cdp('DOM.getDocument');
    const localInput = await cdp('DOM.querySelector', { nodeId: localDocument.root.nodeId, selector: '#fileInput' });
    await cdp('DOM.setFileInputFiles', { nodeId: localInput.nodeId, files: [localFixturePath] });
    await waitFor("sourceMedia?.tagName === 'IMG' && sourceCanvas.width === 512");
    await check('opening from disk starts a real local alignment worker', `(() => {
        window.localAlignment = runAutoDetect();
        return location.protocol === 'file:' && autoAlignJob.worker instanceof Worker;
    })()`);
    await check('opening from disk refines a circle without fetching worker code', `(async () => {
        return await window.localAlignment === true && Math.hypot(ball.x - 250.4, ball.y - 180.7) < 1 && Math.abs(ball.r - 130.3) < 1 && !autoAlignJob;
    })()`);
    assert.deepEqual(exceptions, [], 'No uncaught browser exceptions');
    console.log(`All ${checksPassed} browser regression checks passed.`);
} finally {
    if (socket?.readyState === WebSocket.OPEN) {
        try { await cdp('Browser.close'); } catch {}
        socket.close();
    }
    if (browser && browser.exitCode === null) {
        await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(3000)]);
        if (browser.exitCode === null) browser.kill();
    }
    server.closeAllConnections();
    server.close();
    assert.equal(dirname(profile), resolve(tmpdir()));
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
