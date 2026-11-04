export async function runParameterChecks({ cdp, evaluate, check, delay, loadImage }) {
    const key = async (key, code = key, windowsVirtualKeyCode = 0, modifiers = 0) => {
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };
    const type = async (id, text) => {
        await evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); input.focus({ preventScroll: true }); input.select(); return true; })()`);
        await cdp('Input.insertText', { text });
    };
    const doubleClick = async (rangeId, fraction) => {
        const position = await evaluate(`(() => {
            const range = document.getElementById(${JSON.stringify(rangeId)});
            range.scrollIntoView({ block: 'center' });
            const rect = range.getBoundingClientRect(), fraction = ${fraction === undefined ? '(Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min))' : fraction};
            return { x: rect.left + 5 + fraction * (rect.width - 10), y: rect.top + rect.height / 2 };
        })()`);
        for (const clickCount of [1, 2]) {
            await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', buttons: 1, clickCount });
            await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', buttons: 0, clickCount });
        }
    };
    const drag = async ({ modifiers = 0, dx = 35, dy = 18, x = .45, y = .45 } = {}) => {
        const position = await evaluate(`(() => {
            threeContainer.scrollIntoView({ block: 'center' }); const r = threeContainer.getBoundingClientRect();
            return { x: r.left + r.width * ${x}, y: r.top + r.height * ${y} };
        })()`);
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', buttons: 1, clickCount: 1, modifiers });
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x + dx, y: position.y + dy, button: 'left', buttons: 1, modifiers });
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x + dx, y: position.y + dy, button: 'left', buttons: 0, modifiers });
        return { start: position, end: { x: position.x + dx, y: position.y + dy } };
    };
    await evaluate(`window.parameterTest = {
        values: [...parameterBindings.keys()].map(range => [range.id, range.value]),
        auto: autoCoverageToggle.checked, mode: coverageMode.value, diameter: coverageDiameter.value, distance: coverageDistance.value,
        storage: localStorage.getItem('mirror-ball-coverage-v1'), lon, lat,
        guides: toggleGuidesBtn.getAttribute('aria-pressed') === 'true'
    }; true;`);
    try {
        await check('each parameter slider has a named decimal number editor', `[...parameterBindings].every(([range, binding]) => Number(range.step) === .01 && binding.number.type === 'number' && binding.number.getAttribute('aria-label') && binding.number.value === range.value)`);
        await type('pitchValue', '-12.34');
        await check('typing a signed decimal updates the slider and image rotation live', 'pitchSlider.value === "-12.34" && pitchValue.value === "-12.34" && Number.isFinite(procMaterial.uniforms.uRotation.value.elements[0])');
        await type('pitchValue', '500');
        await check('an out-of-range draft leaves the rendered value valid until committed', 'pitchSlider.value === "-12.34" && pitchValue.value === "500"');
        await key('Enter', 'Enter', 13);
        await check('Enter clamps a numeric entry to the slider bounds', 'pitchSlider.value === "180" && pitchValue.value === "180"');
        await type('pitchValue', '-');
        await key('Escape', 'Escape', 27);
        await check('an unfinished number can be cancelled without writing NaN', 'pitchValue.value === "180" && pitchSlider.value === "180" && [...procMaterial.uniforms.uRotation.value.elements].every(Number.isFinite)');
        await type('pitchValue', '1.25');
        await key('ArrowUp', 'ArrowUp', 38);
        await check('number arrows adjust by one tenth', 'pitchSlider.value === "1.35" && pitchValue.value === "1.35"');
        await key('ArrowDown', 'ArrowDown', 40, 8);
        await key('ArrowUp', 'ArrowUp', 38, 1);
        await check('Shift and Alt provide larger and finer numeric steps', 'pitchSlider.value === "0.36" && pitchValue.value === "0.36"');
        await evaluate('pitchSlider.focus({ preventScroll: true }); true;');
        await key('ArrowRight', 'ArrowRight', 39, 1);
        await check('range keyboard controls share the same decimal precision', 'pitchSlider.value === "0.37" && pitchValue.value === "0.37"');
        await doubleClick('pitchSlider');
        await check('double-clicking a slider handle restores its default', 'pitchSlider.value === "0" && pitchValue.value === "0"');
        await doubleClick('pitchSlider', .2);
        await check('double-clicking the track does not trigger the handle reset', 'Math.abs(Number(pitchSlider.value)) > 20 && pitchValue.value === pitchSlider.value');
        await evaluate('setDetectConfigOpen(true); true;');
        await type('valSensitivity', '25.45');
        await check('detection parameters also accept numeric decimal edits', 'inpSensitivity.value === "25.45" && valSensitivity.value === "25.45"');
        await evaluate(`setDetectConfigOpen(false);
            autoCoverageToggle.checked = true; coverageMode.value = 'geometry'; coverageDiameter.value = 100; coverageDistance.value = 1000; syncCoverageControls(); updateParams();
            fovValue.focus({ preventScroll: true }); yawValue.focus({ preventScroll: true }); true;`);
        await check('focusing and leaving the coverage number keeps automatic coverage enabled', 'autoCoverageToggle.checked && fovValue.value === fovSlider.value');
        await type('fovValue', '353.25');
        await check('editing the coverage number takes manual control with decimal precision', '!autoCoverageToggle.checked && fovSlider.value === "353.25" && Math.abs(procMaterial.uniforms.uFov.value - 353.25 * Math.PI / 180) < 1e-10');

        await evaluate(`(() => {
            resetMedia();
            const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 256;
            const context = canvas.getContext('2d'), image = context.createImageData(384, 256);
            for (let y = 0; y < 256; y++) for (let x = 0; x < 384; x++) image.data.set([Math.round(x / 383 * 255), y, 64, 255], (y * 384 + x) * 4);
            context.putImageData(image, 0, 0); sourceMedia = canvas; initWorkspace();
            Object.assign(ball, { x: 192, y: 128, r: 110 }); widthInput.value = 256;
            autoCoverageToggle.checked = false; fovSlider.value = 360; pitchSlider.value = yawSlider.value = rollSlider.value = 0;
            lon = lat = 0; setOrientationGuides(false); updateParams(); renderProcessor(); render3D();
            parameterTest.pixel = (x, y) => {
                renderProcessor(); render3D();
                const rect = renderer.domElement.getBoundingClientRect(), gl = renderer.getContext(), pixel = new Uint8Array(4);
                gl.readPixels(Math.floor((x - rect.left) / rect.width * renderer.domElement.width), renderer.domElement.height - 1 - Math.floor((y - rect.top) / rect.height * renderer.domElement.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                return Array.from(pixel);
            };
            parameterTest.pose = () => new THREE.Quaternion().setFromEuler(new THREE.Euler(...[pitchSlider, yawSlider, rollSlider].map(input => THREE.Math.degToRad(Number(input.value))), 'YXZ'));
            threeContainer.scrollIntoView({ block: 'center' });
            const r = threeContainer.getBoundingClientRect();
            parameterTest.feature = parameterTest.pixel(r.left + r.width * .45, r.top + r.height * .45);
            return true;
        })()`);
        const grabbed = await drag({ modifiers: 2 });
        await check('Ctrl-drag moves the grabbed image feature and updates orientation without moving the view', `(() => {
            const pixel = parameterTest.pixel(${grabbed.end.x}, ${grabbed.end.y});
            return lon === 0 && lat === 0 && pixel.every((value, i) => Math.abs(value - parameterTest.feature[i]) <= 4)
                && parameterTest.pose().angleTo(new THREE.Quaternion()) > .01 && yawValue.value === yawSlider.value
                && viewerPointerId === null && viewerDragState === null && toggleOrientationEditBtn.getAttribute('aria-pressed') === 'false';
        })()`);
        await evaluate(`pitchSlider.value = yawSlider.value = rollSlider.value = 0; lon = 57; lat = 22; updateParams(); renderProcessor(); render3D();
            toggleOrientationEditBtn.focus({ preventScroll: true }); true;`);
        await key(' ', 'Space', 32);
        await check('viewport edit mode is keyboard-toggleable and explains its gestures', 'toggleOrientationEditBtn.getAttribute("aria-pressed") === "true" && !orientationEditHint.classList.contains("hidden")');
        await evaluate(`(() => { const r = threeContainer.getBoundingClientRect(); parameterTest.feature = parameterTest.pixel(r.left + r.width * .45, r.top + r.height * .45); return true; })()`);
        const panned = await drag({ dx: 28, dy: 13 });
        await check('visual editing follows the same feature after the camera has looked around', `parameterTest.pixel(${panned.end.x}, ${panned.end.y}).every((value, i) => Math.abs(value - parameterTest.feature[i]) <= 4) && lon === 57 && lat === 22`);
        await evaluate('pitchSlider.value = yawSlider.value = rollSlider.value = 0; lon = lat = 0; updateParams(); true;');
        await drag({ modifiers: 8, dx: 50, dy: 0 });
        await check('Shift-drag rolls the image around the viewing direction', 'Math.abs(Number(rollSlider.value) + 10) < .02 && Math.abs(Number(pitchSlider.value)) < .02 && Math.abs(Number(yawSlider.value)) < .02');
        await evaluate('pitchSlider.value = yawSlider.value = rollSlider.value = 0; updateParams(); true;');
        await drag({ dx: 40, dy: 15 });
        await evaluate('parameterTest.coarse = parameterTest.pose().angleTo(new THREE.Quaternion()); pitchSlider.value = yawSlider.value = rollSlider.value = 0; updateParams(); true;');
        await drag({ modifiers: 1, dx: 40, dy: 15 });
        await check('Alt-drag gives finer visual orientation changes', 'parameterTest.pose().angleTo(new THREE.Quaternion()) < parameterTest.coarse * .13 && parameterTest.pose().angleTo(new THREE.Quaternion()) > parameterTest.coarse * .07');
        await evaluate('autoCoverageToggle.checked = true; coverageMode.value = "geometry"; coverageDiameter.value = 100; coverageDistance.value = 1000; syncCoverageControls(); updateParams(); parameterTest.coverage = Number(fovSlider.value); parameterTest.scroll = scrollY; true;');
        const position = await evaluate('(() => { const r = threeContainer.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()');
        await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', ...position, deltaX: 0, deltaY: 100 });
        await delay(50);
        await check('the edit-mode wheel changes Coverage and disables its automatic calculation', '!autoCoverageToggle.checked && Math.abs(Number(fovSlider.value) - parameterTest.coverage + 2) < .001 && fovValue.value === fovSlider.value && scrollY === parameterTest.scroll');
        await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        await evaluate('parameterTest.beforeTouch = parameterTest.pose().clone(); true;');
        await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...position, id: 1 }] });
        await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: position.x + 20, y: position.y + 12, id: 1 }] });
        await cdp('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await check('touch can edit orientation and cancellation clears the drag', 'parameterTest.pose().angleTo(parameterTest.beforeTouch) > .01 && viewerPointerId === null && viewerDragState === null && !isUserInteracting');
        await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    } finally {
        await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
        await evaluate(`(() => {
            const state = parameterTest; document.activeElement?.blur(); resetPointerInteractions();
            for (const [id, value] of state.values) document.getElementById(id).value = value;
            autoCoverageToggle.checked = state.auto; coverageMode.value = state.mode; coverageDiameter.value = state.diameter; coverageDistance.value = state.distance;
            if (state.storage === null) localStorage.removeItem('mirror-ball-coverage-v1'); else localStorage.setItem('mirror-ball-coverage-v1', state.storage);
            toggleOrientationEditBtn.setAttribute('aria-pressed', 'false'); syncOrientationEditMode(); setDetectConfigOpen(false); syncCoverageControls();
            lon = state.lon; lat = state.lat; updateParams(); setOrientationGuides(state.guides); delete window.parameterTest; return true;
        })()`);
        await loadImage();
    }
}
