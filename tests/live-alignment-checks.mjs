import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function runLiveAlignmentChecks({ cdp, evaluate, check, waitFor, loadImage, loadVideo, delay, profile }) {
    const movingPath = join(profile, 'moving-circle.webm');
    await evaluate(`window.liveAlignTest = (() => {
        const state = { Worker: window.Worker, run: runAutoDetect, apply: applyAutoAlignment, saveAs: window.saveAs,
            getUserMedia: navigator.mediaDevices.getUserMedia, loads: 0, loadResults: [], workers: [], timings: [], maxPending: 0, pending: 0 };
        window.Worker = class extends state.Worker {
            constructor(...args) {
                super(...args); state.workers.push(this); this.starts = new Map();
                this.addEventListener('message', event => {
                    const start = this.starts.get(event.data.id);
                    if (start) { state.timings.push({ type: start.type, ms: performance.now() - start.time }); this.starts.delete(event.data.id); state.pending--; }
                });
            }
            postMessage(message, ...args) {
                this.starts.set(message.id, { type: message.type, time: performance.now() });
                state.pending++; state.maxPending = Math.max(state.maxPending, state.pending);
                super.postMessage(message, ...args);
            }
            terminate() { state.pending -= this.starts.size; this.starts.clear(); super.terminate(); }
        };
        runAutoDetect = async options => {
            if (options?.mode === 'load') state.loads++;
            const result = await state.run(options);
            if (options?.mode === 'load') state.loadResults.push(result);
            return result;
        };
        state.draw = (canvas, circle) => {
            const context = canvas.getContext('2d'); context.fillStyle = '#181818'; context.fillRect(0, 0, canvas.width, canvas.height);
            if (circle) { context.fillStyle = '#ddd'; context.beginPath(); context.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2); context.fill(); }
        };
        state.image = async circle => {
            const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 256;
            state.draw(canvas, circle);
            const blob = await new Promise(resolve => canvas.toBlob(resolve));
            handleFileSelect(new File([blob], 'auto-circle.png', { type: 'image/png' }));
        };
        state.near = (target, tolerance = 2) => Math.hypot(ball.x - target.x, ball.y - target.y) < tolerance && Math.abs(ball.r - target.r) < tolerance;
        return state;
    })(); continuousAlignToggle.checked = false; cancelAutoAlign(); true;`);
    try {
        await evaluate('window.liveAlignTest.image({ x: 130.4, y: 123.7, r: 75.3 }).then(() => true)');
        await waitFor("sourceCanvas.width === 384 && initialAutoAlignMediaId === null && !autoAlignJob && window.liveAlignTest.loadResults.length === 1");
        await delay(150);
        await check('a new image runs exactly one automatic alignment after decoding', `liveAlignTest.loads === 1 && liveAlignTest.loadResults[0] === true && liveAlignTest.near({ x: 130.4, y: 123.7, r: 75.3 }, 1)`);
        await evaluate('window.liveAlignTest.image(null).then(() => true)');
        await waitFor('liveAlignTest.loadResults.length === 2 && !autoAlignJob');
        await delay(150);
        await check('an uncertain automatic load keeps the default circle and does not retry', `liveAlignTest.loads === 2 && liveAlignTest.loadResults[1] === false && liveAlignTest.near({ x: 192, y: 128, r: 102.4 }, 0.01)`);

        await evaluate(`(async () => {
            window.movingVideoFile = await window.createTestVideo({ width: 384, height: 256, count: 60, fps: 30, name: 'moving-circle.webm',
                draw(context, i) { context.fillStyle = '#181818'; context.fillRect(0, 0, 384, 256); context.fillStyle = '#ddd'; context.beginPath(); context.arc(100 + i, 128, 60, 0, Math.PI * 2); context.fill(); }
            }); return true;
        })()`);
        const bytes = await evaluate('(async () => Array.from(new Uint8Array(await movingVideoFile.arrayBuffer())))()');
        writeFileSync(movingPath, Buffer.from(bytes));
        await loadVideo(movingPath);
        await check('a video aligns once on its decoded first frame while remaining paused', `liveAlignTest.loads === 3 && liveAlignTest.loadResults[2] === true && sourceVideoHidden.paused && sourceVideoHidden.currentTime === 0 && liveAlignTest.near({ x: 100, y: 128, r: 60 }, 1)`);
        await evaluate(`liveAlignTest.liveStartWorkers = liveAlignTest.workers.length;
            continuousAlignToggle.checked = true; continuousAlignToggle.dispatchEvent(new Event('change')); true;`);
        await waitFor("autoAlignJob?.mode === 'continuous' && autoAlignJob.locked && autoAlignJob.frameWait !== null");
        await evaluate('sourceVideoHidden.play().then(() => true)');
        await waitFor('sourceVideoHidden.currentTime > 1.1 && liveAlignTest.timings.filter(item => item.type === "track").length >= 20');
        await check('continuous video tracking follows motion with one worker and no pending frame queue', `(() => {
            const frame = Math.min(59, Math.floor(sourceVideoHidden.currentTime * 30));
            return liveAlignTest.near({ x: 100 + frame, y: 128, r: 60 }, 12)
                && liveAlignTest.workers.length === liveAlignTest.liveStartWorkers + 1 && liveAlignTest.maxPending === 1 && !sourceVideoHidden.paused;
        })()`);
        await evaluate('sourceVideoHidden.pause(); true;');
        await delay(150);
        await waitFor('autoAlignJob?.frameWait !== null && !autoAlignJob?.pending');
        await evaluate('liveAlignTest.pausedTasks = liveAlignTest.timings.length; true;');
        await delay(200);
        await check('a paused video waits without repeatedly detecting the same frame', 'liveAlignTest.pausedTasks === liveAlignTest.timings.length && continuousAlignToggle.checked');
        await evaluate('autoAlignJob.worker.dispatchEvent(new MessageEvent("messageerror")); true;');
        await waitFor('!autoAlignJob');
        await check('worker failure while awaiting a paused frame stops tracking cleanly', '!continuousAlignToggle.checked && autoDetectBtn.textContent === "Auto align" && toastContainer.lastElementChild.classList.contains("error")');
        await evaluate('continuousAlignToggle.checked = true; continuousAlignToggle.dispatchEvent(new Event("change")); true;');
        await waitFor('autoAlignJob?.locked');
        await evaluate('videoSeek.value = 15; videoSeek.dispatchEvent(new Event("input")); true;');
        await waitFor('!sourceVideoHidden.seeking && autoAlignJob?.locked && autoAlignJob.frameWait !== null');
        await check('seeking restarts tracking on the chosen frame and keeps the toggle enabled', 'continuousAlignToggle.checked && sourceVideoHidden.paused && liveAlignTest.near({ x: 109, y: 128, r: 60 }, 3)');
        await evaluate('liveAlignTest.manual = { ...ball }; sourceCanvas.focus({ preventScroll: true }); true;');
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
        await delay(100);
        await check('manual circle edits turn continuous alignment off', '!continuousAlignToggle.checked && !autoAlignJob && ball.x === liveAlignTest.manual.x + 1');

        await evaluate(`liveAlignTest.exports = []; liveAlignTest.samples = [];
            window.saveAs = (blob, name) => liveAlignTest.exports.push({ blob, name });
            applyAutoAlignment = (job, circle) => { if (job.mode === 'export') liveAlignTest.samples.push({ time: sourceVideoHidden.currentTime, ...circle }); return liveAlignTest.apply(job, circle); };
            continuousAlignToggle.checked = true; fpsInput.value = 10; formatSelect.value = 'png'; true;`);
        await check('tracked export aligns every selected frame before encoding it', `(async () => {
            await startFrameExport();
            continuousAlignToggle.checked = false; cancelAutoAlign();
            const samples = liveAlignTest.samples, archive = liveAlignTest.exports[0];
            if (!archive) return false;
            const zip = await JSZip.loadAsync(archive.blob), names = Object.keys(zip.files).filter(name => !zip.files[name].dir);
            return names.length === 20 && samples.length === 20 && samples.every((circle, i) => Math.abs(circle.x - (100 + i * 3)) < 4 && Math.abs(circle.time - i / 10) < 0.015)
                && samples[19].x - samples[0].x > 50 && !isExportingFrames && !continuousAlignToggle.disabled;
        })()`);
        await check('tracked export stays active when hidden and Cancel settles pending worker work', `(async () => {
            const NativeWorker = window.Worker;
            window.Worker = class { postMessage() {} terminate() {} };
            continuousAlignToggle.checked = true; fpsInput.value = 2;
            try {
                const pending = startFrameExport();
                // Let the first seek finish so the worker is waiting for a reply.
                for (let i = 0; i < 100 && !autoAlignJob?.pending; i++) await new Promise(resolve => setTimeout(resolve, 10));
                Object.defineProperty(document, 'hidden', { configurable: true, value: true });
                document.dispatchEvent(new Event('visibilitychange'));
                const preserved = isExportingFrames && autoAlignJob?.mode === 'export' && !exportController.signal.aborted;
                exportFramesBtn.click(); await pending;
                return preserved && !isExportingFrames && !autoAlignJob && !autoDetectBtn.disabled && !continuousAlignToggle.disabled && liveAlignTest.exports.length === 1;
            } finally {
                delete document.hidden; window.Worker = NativeWorker;
                continuousAlignToggle.checked = false; cancelAutoAlign();
            }
        })()`);

        await loadImage();
        await evaluate(`(() => {
            const state = liveAlignTest, canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 256;
            state.cameraCanvas = canvas; state.cameraTarget = { x: 140, y: 128, r: 70 };
            state.draw(canvas, state.cameraTarget);
            state.stream = canvas.captureStream(15);
            state.cameraTimer = setInterval(() => state.draw(canvas, state.cameraTarget), 67);
            navigator.mediaDevices.getUserMedia = async () => state.stream;
            state.beforeCameraLoads = state.loads;
            toggleWebcam(); return true;
        })()`);
        await waitFor('isWebcam && !mediaLoading && initialAutoAlignMediaId === null && !autoAlignJob');
        await check('camera startup automatically aligns its first usable frame once', 'liveAlignTest.loads === liveAlignTest.beforeCameraLoads + 1 && liveAlignTest.near(liveAlignTest.cameraTarget, 1) && !continuousAlignControl.classList.contains("hidden")');
        await evaluate('continuousAlignToggle.checked = true; continuousAlignToggle.dispatchEvent(new Event("change")); true;');
        await waitFor('autoAlignJob?.locked');
        await evaluate('liveAlignTest.cameraTarget = { x: 150, y: 128, r: 70 }; true;');
        await waitFor('Math.abs(ball.x - 150) < 3');
        await check('live camera tracking follows new captured frames', 'isWebcam && !sourceVideoHidden.paused && autoAlignJob?.mode === "continuous" && liveAlignTest.near(liveAlignTest.cameraTarget, 3)');
        await evaluate('liveAlignTest.cameraTarget = null; true;');
        await waitFor('autoAlignJob?.misses >= 1');
        await evaluate('liveAlignTest.heldCircle = { ...ball }; liveAlignTest.beforeLossToasts = toastContainer.children.length; true;');
        await waitFor('autoAlignJob?.misses >= 3');
        await check('loss of the camera rim holds the last circle without repeated notifications', 'JSON.stringify(ball) === JSON.stringify(liveAlignTest.heldCircle) && toastContainer.children.length <= liveAlignTest.beforeLossToasts');
        await evaluate('liveAlignTest.cameraTarget = { x: 155, y: 128, r: 70 }; true;');
        await waitFor('autoAlignJob?.misses === 0 && Math.abs(ball.x - 155) < 3');
        await check('camera tracking reacquires supported rims after an occlusion', 'liveAlignTest.near(liveAlignTest.cameraTarget, 3)');
        await evaluate('stopWebcam(); true;');
        await check('stopping the camera cancels tracking and ends its capture stream', '!autoAlignJob && !isWebcam && liveAlignTest.stream.getTracks().every(track => track.readyState === "ended")');

        await evaluate('continuousAlignToggle.checked = false; true;');
        await loadVideo(movingPath);
        await check('a frame arriving during detection is consumed immediately without waiting for another frame', `(async () => {
            const NativeWorker = window.Worker;
            window.Worker = class { constructor() { this.messages = []; } postMessage(message) { this.messages.push(message); } terminate() {} };
            stopVideoFrameWatch();
            videoFrameWatch = { mediaId: mediaRequestId, callbackId: null, native: true, hasFrame: true };
            try {
                continuousAlignToggle.checked = true; continuousAlignToggle.dispatchEvent(new Event('change'));
                const worker = autoAlignJob.worker, candidate = { x: 100, y: 128, r: 60, score: .95, confidence: .95, coverage: 1 };
                recordDecodedVideoFrame(videoFrameWatch, sourceVideoHidden.currentTime);
                worker.onmessage({ data: { id: worker.messages[0].id, result: { candidates: [candidate], best: candidate, reason: 'aligned' } } });
                for (let i = 0; i < 10 && worker.messages.length < 2; i++) await Promise.resolve();
                const fine = worker.messages[1]; if (!fine) return false;
                worker.onmessage({ data: { id: fine.id, result: { candidates: [candidate], best: candidate, reason: 'aligned' } } });
                for (let i = 0; i < 20 && worker.messages.length < 3; i++) await Promise.resolve();
                return worker.messages.length === 3 && worker.messages[2].type === 'track' && autoAlignJob.frameWait === null;
            } finally {
                continuousAlignToggle.checked = false; cancelAutoAlign(); window.Worker = NativeWorker; startVideoFrameWatch(mediaRequestId);
            }
        })()`);
        await evaluate(`Object.defineProperty(sourceVideoHidden, 'requestVideoFrameCallback', { configurable: true, value: undefined }); true;`);
        try {
            await loadVideo(movingPath);
            await evaluate('continuousAlignToggle.checked = true; continuousAlignToggle.dispatchEvent(new Event("change")); sourceVideoHidden.play().then(() => true)');
            await waitFor('sourceVideoHidden.currentTime > 0.8 && autoAlignJob?.locked');
            await check('browsers without video-frame callbacks track through decoded-frame polling', `!videoFrameWatch.native && liveAlignTest.near({ x: 100 + Math.min(59, Math.floor(sourceVideoHidden.currentTime * 30)), y: 128, r: 60 }, 12)`);
        } finally {
            await evaluate('continuousAlignToggle.checked = false; cancelAutoAlign(); delete sourceVideoHidden.requestVideoFrameCallback; true;');
        }
        await evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            liveAlignTest.hiddenLoads = liveAlignTest.loads;
            liveAlignTest.image({ x: 170, y: 128, r: 70 }).then(() => true);`);
        await waitFor("sourceMedia?.tagName === 'IMG' && initialAutoAlignMediaId === mediaRequestId");
        await evaluate(`document.dispatchEvent(new Event('visibilitychange'));
            delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); true;`);
        await waitFor('initialAutoAlignMediaId === null && !autoAlignJob && liveAlignTest.loadResults.length === liveAlignTest.loads');
        await check('an initial load queued while hidden runs once when the tab becomes visible', 'liveAlignTest.loads === liveAlignTest.hiddenLoads + 1 && liveAlignTest.near({ x: 170, y: 128, r: 70 }, 1)');

        const performance = await evaluate(`(() => {
            const times = liveAlignTest.timings.filter(item => item.type === 'track').map(item => item.ms).sort((a,b) => a-b);
            return { samples: times.length, p50Ms: times[Math.floor(times.length * .5)], p95Ms: times[Math.floor(times.length * .95)], maxPending: liveAlignTest.maxPending };
        })()`);
        console.log('Continuous worker round trips on synthetic media:', JSON.stringify(performance));
    } finally {
        await evaluate(`(() => {
            const state = liveAlignTest;
            delete document.hidden;
            continuousAlignToggle.checked = false; cancelAutoAlign();
            if (isWebcam) stopWebcam();
            clearInterval(state.cameraTimer); state.stream?.getTracks().forEach(track => track.stop());
            window.Worker = state.Worker; runAutoDetect = state.run; applyAutoAlignment = state.apply;
            window.saveAs = state.saveAs; navigator.mediaDevices.getUserMedia = state.getUserMedia;
            delete window.liveAlignTest; return true;
        })()`);
        await loadImage();
    }
}
