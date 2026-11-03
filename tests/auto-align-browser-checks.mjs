export async function runAutoAlignBrowserChecks({ cdp, evaluate, check, waitFor, loadImage, delay }) {
    await evaluate(`window.__alignBrowserTest = (() => {
        const state = {
            Worker: window.Worker, setTimeout: window.setTimeout,
            analyze: MirrorBallAlign.analyze, refineMany: MirrorBallAlign.refineMany,
            sensitivity: inpSensitivity.value, bias: inpBias.value, prefer: preferCircleToggle.checked,
            workers: [], timeout: null,
        };
        state.draw = (canvas, circles) => {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.fillStyle = '#181818'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#bebebe';
            for (const circle of circles) { ctx.beginPath(); ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2); ctx.fill(); }
        };
        state.scene = (width = 320, height = 256, circles = [{ x: 154.35, y: 123.7, r: 85.45 }]) => {
            resetMedia();
            const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
            state.draw(canvas, circles); sourceMedia = canvas; initWorkspace();
            state.canvas = canvas; state.circles = circles; preferCircleToggle.checked = false;
            inpSensitivity.value = 25; inpBias.value = 60; widthInput.value = 256; updateParams();
        };
        state.settle = promise => {
            let timer;
            return Promise.race([
                Promise.resolve(promise).then(value => ({ settled: true, value })),
                new Promise(resolve => { timer = state.setTimeout.call(window, () => resolve({ settled: false }), 8000); }),
            ]).finally(() => clearTimeout(timer));
        };
        state.control = () => {
            state.workers = []; state.timeout = null;
            window.Worker = class {
                constructor() { this.messages = []; this.terminated = false; state.workers.push(this); }
                postMessage(message) { this.messages.push(message); }
                terminate() { this.terminated = true; }
            };
        };
        state.restore = () => {
            window.Worker = state.Worker; window.setTimeout = state.setTimeout;
            MirrorBallAlign.analyze = state.analyze; MirrorBallAlign.refineMany = state.refineMany;
        };
        state.idle = () => autoAlignJob === null && autoDetectBtn.getAttribute('aria-busy') === 'false'
            && autoDetectBtn.textContent === 'Auto align' && autoAlignStatus.textContent === '';
        state.near = (circle, target, tolerance = 1) => Math.hypot(circle.x - target.x, circle.y - target.y) <= tolerance
            && Math.abs(circle.r - target.r) <= tolerance;
        return state;
    })(); true;`);

    try {
        await check('worker alignment refines fractional source coordinates and keeps both stages on the captured frame', `(async () => {
            const state = window.__alignBrowserTest, target = { x: 1003.35, y: 731.65, r: 512.25 };
            state.scene(2037, 1379, [target]);
            const stages = []; let workers = 0, terminated = 0;
            window.Worker = class extends state.Worker {
                constructor(...args) { super(...args); workers++; }
                postMessage(message, transfer) { stages.push({ type: message.type, width: message.width, height: message.height }); super.postMessage(message, transfer); }
                terminate() { terminated++; super.terminate(); }
            };
            try {
                const pending = runAutoDetect(), busy = autoDetectBtn.getAttribute('aria-busy') === 'true';
                // A changing canvas stands in for a frame changing while the worker runs.
                state.draw(state.canvas, [{ ...target, x: target.x + 160, r: target.r - 65 }]);
                const outcome = await state.settle(pending);
                if (!state.near(ball, target)) throw new Error('Fractional source fit: ' + JSON.stringify({ target, actual: ball }));
                return outcome.settled && outcome.value === true && busy && workers === 1 && terminated === 1 && state.idle()
                    && stages.length === 2 && stages[0].type === 'analyze' && stages[0].width === 320
                    && stages[1].type === 'refine' && stages[1].width === 1536 && stages[1].height === 1040;
            } finally { cancelAutoAlign(); state.restore(); }
        })()`);

        await evaluate(`window.__alignBrowserTest.scene(320, 256, [{ x: 90, y: 128, r: 50 }, { x: 230, y: 128, r: 50 }]);
            Object.assign(ball, { x: 232, y: 126, r: 51 }); updateParams(); window.__alignBrowserTest.manual = { ...ball }; true;`);
        await check('equally plausible circles keep the manual alignment and explain the ambiguity', `(async () => {
            const state = window.__alignBrowserTest, outcome = await state.settle(runAutoDetect());
            return outcome.settled && outcome.value === false && JSON.stringify(ball) === JSON.stringify(state.manual)
                && state.idle() && toastContainer.lastElementChild.textContent.includes('Several circles');
        })()`);
        await check('Prefer current circle resolves supported competing circles', `(async () => {
            const state = window.__alignBrowserTest;
            try {
                preferCircleToggle.checked = true;
                const outcome = await state.settle(runAutoDetect());
                return outcome.settled && outcome.value === true && state.near(ball, { x: 230, y: 128, r: 50 }) && state.idle();
            } finally { preferCircleToggle.checked = false; }
        })()`);

        await evaluate(`(() => {
            const state = window.__alignBrowserTest; state.scene(); state.control();
            state.manual = { ...ball }; sourceCanvas.focus({ preventScroll: true });
            state.pending = runAutoDetect(); return true;
        })()`);
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
        await check('a manual keyboard edit cancels detection, settles its promise, and ignores a late worker reply', `(async () => {
            const state = window.__alignBrowserTest;
            try {
                const worker = state.workers[0], outcome = await state.settle(state.pending);
                const edited = { ...ball }, message = worker.messages[0];
                worker.onmessage({ data: { id: message.id, result: { candidates: [], best: { x: 1, y: 1, r: 10 } } } });
                await Promise.resolve();
                return outcome.settled && outcome.value === false && worker.terminated && state.idle()
                    && edited.x === state.manual.x + 1 && edited.y === state.manual.y && edited.r === state.manual.r
                    && JSON.stringify(ball) === JSON.stringify(edited);
            } finally { cancelAutoAlign(); state.restore(); }
        })()`);

        await check('media reset cancels pending detection and settles its promise', `(async () => {
            const state = window.__alignBrowserTest; state.scene(); state.control();
            try {
                const pending = runAutoDetect(), worker = state.workers[0]; resetMedia();
                const outcome = await state.settle(pending);
                return outcome.settled && outcome.value === false && worker.terminated && sourceMedia === null && state.idle();
            } finally { cancelAutoAlign(); state.restore(); }
        })()`);

        await check('cancel and immediate restart keep the new job and its busy controls intact', `(async () => {
            const state = window.__alignBrowserTest; state.scene(); state.control();
            try {
                const before = { ...ball }, previous = runAutoDetect(), oldWorker = state.workers[0];
                cancelAutoAlign();
                const next = runAutoDetect(), currentJob = autoAlignJob, newWorker = state.workers[1];
                const previousOutcome = await state.settle(previous);
                oldWorker.onmessage({ data: { id: oldWorker.messages[0].id, result: { candidates: [], best: null } } });
                await Promise.resolve();
                const intact = autoAlignJob === currentJob && !newWorker.terminated
                    && autoDetectBtn.getAttribute('aria-busy') === 'true' && autoDetectBtn.textContent === 'Cancel align'
                    && autoAlignStatus.textContent.length > 0;
                cancelAutoAlign(); const nextOutcome = await state.settle(next);
                return previousOutcome.settled && previousOutcome.value === false && oldWorker.terminated && intact
                    && nextOutcome.settled && nextOutcome.value === false && newWorker.terminated && state.idle()
                    && JSON.stringify(ball) === JSON.stringify(before);
            } finally { cancelAutoAlign(); state.restore(); }
        })()`);

        await check('a preferred fifth coarse candidate survives the bounded refinement shortlist', `(async () => {
            const state = window.__alignBrowserTest, target = { x: 250, y: 128, r: 35 };
            state.scene(320, 256, [target]); state.control(); Object.assign(ball, target); preferCircleToggle.checked = true;
            try {
                const pending = runAutoDetect(), worker = state.workers[0];
                const candidates = [30, 75, 120, 165, 250].map(x => ({ x, y: 128, r: 35, score: 0.9, confidence: 0.9, coverage: 1 }));
                worker.onmessage({ data: { id: worker.messages[0].id, result: { candidates, best: candidates[4], reason: 'aligned-prior' } } });
                await Promise.resolve();
                const fine = worker.messages[1], kept = fine?.type === 'refine' && fine.candidates.length <= 4
                    && fine.candidates.some(circle => state.near(circle, target, 0.001));
                if (!fine) { cancelAutoAlign(); await state.settle(pending); return false; }
                worker.onmessage({ data: { id: fine.id, result: { candidates: [candidates[4]], best: candidates[4], reason: 'aligned-prior' } } });
                const outcome = await state.settle(pending);
                return kept && outcome.settled && outcome.value === true && state.near(ball, target) && state.idle();
            } finally { cancelAutoAlign(); preferCircleToggle.checked = false; state.restore(); }
        })()`);

        await check('worker construction failure uses bounded yielding fallback stages and still aligns', `(async () => {
            const state = window.__alignBrowserTest, target = { x: 1003.35, y: 731.65, r: 512.25 };
            state.scene(2037, 1379, [target]); const calls = []; let attempted = 0;
            window.Worker = class { constructor() { attempted++; throw new Error('Workers blocked for this test'); } };
            MirrorBallAlign.analyze = (...args) => { calls.push({ type: 'analyze', width: args[1], height: args[2] }); return state.analyze(...args); };
            MirrorBallAlign.refineMany = (...args) => { calls.push({ type: 'refine', width: args[1], height: args[2] }); return state.refineMany(...args); };
            try {
                const pending = runAutoDetect(), yielded = calls.length === 0 && autoAlignJob !== null;
                const outcome = await state.settle(pending);
                return outcome.settled && outcome.value === true && attempted === 1 && yielded && state.near(ball, target)
                    && calls.length === 2 && calls[0].type === 'analyze' && calls[0].width <= 320 && calls[0].height <= 320
                    && calls[1].type === 'refine' && calls[1].width <= 1536 && calls[1].height <= 1536 && state.idle();
            } finally { cancelAutoAlign(); state.restore(); }
        })()`);

        for (const failure of ['error', 'messageerror', 'timeout']) {
            await check(`worker ${failure} preserves alignment, settles, and restores usable controls`, `(async () => {
                const state = window.__alignBrowserTest; state.scene(); state.control();
                const before = { ...ball }; let prevented = false;
                if (${JSON.stringify(failure)} === 'timeout') {
                    window.setTimeout = (callback, ms, ...args) => {
                        if (ms === 10000) { state.timeout = () => callback(...args); return 0; }
                        return state.setTimeout.call(window, callback, ms, ...args);
                    };
                }
                try {
                    const pending = runAutoDetect(), worker = state.workers[0];
                    if (${JSON.stringify(failure)} === 'error') worker.onerror({ preventDefault() { prevented = true; } });
                    else if (${JSON.stringify(failure)} === 'messageerror') worker.onmessageerror({});
                    else { if (!state.timeout) throw new Error('No worker timeout installed'); state.timeout(); }
                    const outcome = await state.settle(pending);
                    return outcome.settled && outcome.value === false && worker.terminated && state.idle()
                        && JSON.stringify(ball) === JSON.stringify(before) && toastContainer.lastElementChild.classList.contains('error')
                        && toastContainer.lastElementChild.textContent.length > 0 && (${JSON.stringify(failure)} !== 'error' || prevented);
                } finally { cancelAutoAlign(); state.restore(); }
            })()`);
            await check(`alignment can retry with a real worker after ${failure}`, `(async () => {
                const state = window.__alignBrowserTest, outcome = await state.settle(runAutoDetect());
                return outcome.settled && outcome.value === true && state.near(ball, state.circles[0]) && state.idle();
            })()`);
        }
    } finally {
        await evaluate(`(() => {
            cancelAutoAlign(); const state = window.__alignBrowserTest; state.restore();
            inpSensitivity.value = state.sensitivity; inpBias.value = state.bias; preferCircleToggle.checked = state.prefer;
            delete window.__alignBrowserTest; return true;
        })()`);
        await loadImage();
        await waitFor("sourceMedia?.tagName === 'IMG' && !mediaLoading && autoAlignJob === null");
        await delay(0);
    }
}
