export async function runPreviewGuideChecks({ cdp, evaluate, check, loadImage }) {
    await check('orientation guides start off without allocating an overlay', 'toggleGuidesBtn.getAttribute("aria-pressed") === "false" && orientationGuides === null');
    await evaluate(`window.previewGuideTest = (() => {
        const state = { map: sphereMesh.material.map, lon, lat, pitch: pitchSlider.value, yaw: yawSlider.value, roll: rollSlider.value };
        state.texture = new THREE.DataTexture(new Uint8Array([96, 96, 96, 255]), 1, 1, THREE.RGBAFormat);
        state.texture.needsUpdate = true;
        sphereMesh.material.map = state.texture; sphereMesh.material.needsUpdate = true;
        lon = lat = 0; render3D(); renderProcessor();
        state.export = procCanvas.toDataURL();
        state.pixels = () => {
            const gl = renderer.getContext(), pixels = new Uint8Array(renderer.domElement.width * renderer.domElement.height * 4);
            gl.readPixels(0, 0, renderer.domElement.width, renderer.domElement.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return pixels;
        };
        state.pixel = (x, y) => {
            const gl = renderer.getContext(), pixel = new Uint8Array(4);
            gl.readPixels(Math.floor(x * renderer.domElement.width), Math.floor(y * renderer.domElement.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            return pixel[0];
        };
        state.baseline = state.pixels();
        toggleGuidesBtn.focus({ preventScroll: true });
        return state;
    })(); true;`);
    try {
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        await check('the keyboard toggle draws a horizon and thin reference lines in the 360 preview', `(() => {
            render3D();
            const state = previewGuideTest, pixels = state.pixels();
            let changed = 0;
            for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== state.baseline[i]) changed++;
            return toggleGuidesBtn.getAttribute('aria-pressed') === 'true' && orientationGuides.visible
                && state.pixel(.35, .5) > 160 && Math.abs(state.pixel(.35, .6) - 96) < 2
                && changed > 100 && changed < pixels.length / 4 * .18 && renderer.getContext().getError() === 0;
        })()`);
        await check('preview guides leave exported projection pixels unchanged', `(() => {
            renderProcessor(); return procCanvas.toDataURL() === previewGuideTest.export;
        })()`);
        await check('orientation references stay fixed while pitch, yaw, and roll change', `(() => {
            render3D();
            const before = previewGuideTest.pixels();
            pitchSlider.value = 17; yawSlider.value = 21; rollSlider.value = 36; updateParams(); renderProcessor(); render3D();
            return previewGuideTest.pixels().every((value, index) => value === before[index]);
        })()`);
        await check('the guide horizon follows world orientation when looking around', `(() => {
            lon = 37; lat = 18; render3D();
            const heading = THREE.Math.degToRad(lon + 180);
            const horizon = new THREE.Vector3(500 * Math.cos(heading), 0, 500 * Math.sin(heading)).project(camera);
            const x = horizon.x * .5 + .5, y = horizon.y * .5 + .5;
            return y > .1 && y < .4 && previewGuideTest.pixel(x, y) > 160;
        })()`);
        await check('turning guides off restores the unmarked preview', `(() => {
            lon = lat = 0; toggleGuidesBtn.click(); render3D();
            return toggleGuidesBtn.getAttribute('aria-pressed') === 'false' && !orientationGuides.visible
                && previewGuideTest.pixels().every((value, index) => value === previewGuideTest.baseline[index]);
        })()`);
        await evaluate(`(() => {
            const state = previewGuideTest;
            sphereMesh.material.map = state.map; sphereMesh.material.needsUpdate = true;
            pitchSlider.value = state.pitch; yawSlider.value = state.yaw; rollSlider.value = state.roll; updateParams(); renderProcessor();
            setOrientationGuides(true); state.overlay = orientationGuides; return true;
        })()`);
        await loadImage();
        await check('the guide preference survives media changes without creating duplicate overlays', 'toggleGuidesBtn.getAttribute("aria-pressed") === "true" && orientationGuides === previewGuideTest.overlay && orientationGuides.visible');
    } finally {
        await evaluate(`(() => {
            const state = previewGuideTest;
            sphereMesh.material.map = state.map; sphereMesh.material.needsUpdate = true;
            state.texture.dispose();
            pitchSlider.value = state.pitch; yawSlider.value = state.yaw; rollSlider.value = state.roll;
            lon = state.lon; lat = state.lat; updateParams(); renderProcessor(); setOrientationGuides(false);
            delete window.previewGuideTest; return true;
        })()`);
    }
}
