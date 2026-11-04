import exifFixtures from './fixtures/coverage/exif.cjs';

export async function runCoverageChecks({ cdp, evaluate, check, waitFor, loadImage }) {
    const segment = Array.from(exifFixtures.exifSegment({ focalLength35mm: 50, width: 320, height: 256 }));
    await evaluate(`window.coverageTest = {
        enabled: autoCoverageToggle.checked, mode: coverageMode.value, focal: coverageFocalLength.value,
        diameter: coverageDiameter.value, distance: coverageDistance.value, fov: fovSlider.value,
        saved: localStorage.getItem('mirror-ball-coverage-v1'), reader: MirrorBallCoverage.readJpegExif
    }; true;`);
    try {
        await evaluate(`(async () => {
            const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 256;
            const context = canvas.getContext('2d'); context.fillStyle = '#181818'; context.fillRect(0, 0, 320, 256);
            context.fillStyle = '#ddd'; context.beginPath(); context.arc(160, 128, 80, 0, Math.PI * 2); context.fill();
            const jpeg = new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 1))).arrayBuffer());
            coverageTest.jpeg = new File([jpeg.subarray(0, 2), new Uint8Array(${JSON.stringify(segment)}), jpeg.subarray(2)], 'focal-circle.jpg', { type: 'image/jpeg' });
            coverageTest.png = new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))], 'no-metadata.png', { type: 'image/png' });
            coverageMode.value = 'metadata'; autoCoverageToggle.checked = true;
            autoCoverageToggle.dispatchEvent(new Event('change'));
            handleFileSelect(coverageTest.jpeg); return true;
        })()`);
        await waitFor("sourceMedia?.tagName === 'IMG' && sourceCanvas.width === 320 && !autoAlignJob && initialAutoAlignMediaId === null && coverageMetadata?.focalLength35mm === 50");
        await check('Auto Coverage applies photo focal metadata after circle alignment', `Math.abs(ball.r - 80) < 1 && Math.abs(Number(fovSlider.value) - 340.8) < .11 && fovValue.value === fovSlider.value && autoCoverageStatus.textContent.includes('Photo estimate')`);
        await check('fractional coverage reaches the shader without integer truncation', 'Math.abs(procMaterial.uniforms.uFov.value - Number(fovSlider.value) * Math.PI / 180) < 1e-10 && Number(fovSlider.value) % 1 !== 0');
        await evaluate('coverageTest.beforeOverride = Number(fovSlider.value); fovSlider.focus({ preventScroll: true }); true;');
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
        await check('moving the Coverage slider turns automatic coverage off and preserves the manual value', 'autoCoverageToggle.checked === false && Number(fovSlider.value) > coverageTest.beforeOverride && coverageCalibration.classList.contains("hidden") && JSON.parse(localStorage.getItem("mirror-ball-coverage-v1")).enabled === false');
        await evaluate(`coverageMode.value = 'lens'; coverageFocalLength.value = 50; autoCoverageToggle.checked = true;
            autoCoverageToggle.dispatchEvent(new Event('change')); coverageTest.beforeResize = Number(fovSlider.value);
            sourceCanvas.focus({ preventScroll: true }); true;`);
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 8 });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 8 });
        await check('lens calibration recomputes the blind spot as the aligned circle changes size', 'autoCoverageToggle.checked && Number(fovSlider.value) < coverageTest.beforeResize && autoCoverageStatus.textContent.includes("Lens estimate")');
        await evaluate(`coverageMode.value = 'geometry'; coverageDiameter.value = 100; coverageDistance.value = 1000;
            coverageMode.dispatchEvent(new Event('change')); true;`);
        await check('physical ball and camera calibration calculates the angular blind cone', 'fovSlider.value === "354.3" && autoCoverageStatus.textContent.includes("5.7°") && document.getElementById("coverageLensField").classList.contains("hidden")');
        await evaluate('coverageDistance.value = 40; coverageDistance.dispatchEvent(new Event("input")); true;');
        await check('an impossible camera distance leaves the existing coverage intact', 'fovSlider.value === "354.3" && autoCoverageStatus.textContent.includes("must exceed") && Number.isFinite(procMaterial.uniforms.uFov.value)');
        await evaluate(`coverageDistance.value = 1000; coverageDistance.dispatchEvent(new Event('input'));
            autoCoverageToggle.checked = false; coverageMode.value = 'metadata'; coverageDiameter.value = ''; coverageDistance.value = '';
            restoreCoverageSettings(); updateParams(); true;`);
        await check('the selected calibration and automatic preference restore from browser storage', 'autoCoverageToggle.checked && coverageMode.value === "geometry" && coverageDiameter.value === "100" && coverageDistance.value === "1000" && fovSlider.value === "354.3"');
        await evaluate(`coverageMode.value = 'metadata'; coverageMode.dispatchEvent(new Event('change'));
            handleFileSelect(coverageTest.png); true;`);
        await waitFor("sourceMedia?.tagName === 'IMG' && sourceCanvas.width === 320 && coverageMetadata === null && !autoAlignJob && initialAutoAlignMediaId === null");
        await check('a new file without EXIF cannot reuse focal metadata from the previous image', 'autoCoverageToggle.checked && autoCoverageStatus.textContent.includes("No focal metadata") && Number.isFinite(Number(fovSlider.value))');
        await evaluate(`MirrorBallCoverage.readJpegExif = () => new Promise(resolve => coverageTest.resolveOld = resolve);
            handleFileSelect(coverageTest.jpeg);
            MirrorBallCoverage.readJpegExif = coverageTest.reader;
            handleFileSelect(coverageTest.png);
            coverageTest.resolveOld({ focalLength35mm: 500 }); true;`);
        await waitFor("sourceMedia?.tagName === 'IMG' && sourceCanvas.width === 320 && !autoAlignJob && initialAutoAlignMediaId === null");
        await check('a late focal metadata result cannot alter the replacement file', 'coverageMetadata === null && pendingCoverageMetadata === null && autoCoverageStatus.textContent.includes("No focal metadata")');
    } finally {
        await evaluate(`(() => {
            const state = coverageTest;
            MirrorBallCoverage.readJpegExif = state.reader;
            autoCoverageToggle.checked = state.enabled; coverageMode.value = state.mode; coverageFocalLength.value = state.focal;
            coverageDiameter.value = state.diameter; coverageDistance.value = state.distance; fovSlider.value = state.fov;
            if (state.saved === null) localStorage.removeItem('mirror-ball-coverage-v1'); else localStorage.setItem('mirror-ball-coverage-v1', state.saved);
            syncCoverageControls(); updateParams(); delete window.coverageTest; return true;
        })()`);
        await loadImage();
    }
}
