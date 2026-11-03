export async function runCorrectnessChecks({ evaluate, check, waitFor, loadImage }) {
    await evaluate(`window.circleFixture = (width, height, draw) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#fff'; draw(ctx);
        return ctx.getImageData(0, 0, width, height).data;
    }; true;`);
    for (const [width, height, x, y, radius] of [[256, 192, 128, 96, 70], [192, 256, 90, 140, 65], [256, 192, 85, 78, 48]]) {
        await check(`circle detection finds radius ${radius} in ${width}×${height} reference`, `(() => {
            const pixels = window.circleFixture(${width}, ${height}, ctx => { ctx.beginPath(); ctx.arc(${x}, ${y}, ${radius}, 0, Math.PI * 2); ctx.fill(); });
            const result = detectCircle(pixels, ${width}, ${height}, 0.25, 0.6);
            return result !== null && Math.hypot(result.x - ${x}, result.y - ${y}) <= 3 && Math.abs(result.r - ${radius}) <= 3;
        })()`);
    }
    await check('circle detection rejects blank, transparent, and tiny inputs', `(() => {
        const blank = window.circleFixture(128, 128, () => {});
        const transparent = new Uint8ClampedArray(128 * 128 * 4); transparent.fill(255);
        for (let i = 3; i < transparent.length; i += 4) transparent[i] = 0;
        return !detectCircle(blank, 128, 128, 0.25, 0.6) && !detectCircle(transparent, 128, 128, 0.25, 0.6) && !detectCircle(new Uint8ClampedArray(16), 2, 2, 0.25, 0.6);
    })()`);
    await check('circle detection rejects rectangular edges and an incomplete arc', `(() => {
        const square = window.circleFixture(256, 256, ctx => ctx.fillRect(60, 60, 136, 136));
        const arc = window.circleFixture(256, 256, ctx => { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(128, 128, 70, 0, Math.PI * 0.7); ctx.stroke(); });
        return !detectCircle(square, 256, 256, 0.25, 0.6) && !detectCircle(arc, 256, 256, 0.25, 0.6);
    })()`);
    await check('circle detection rejects reproducible image noise', `(() => {
        let state = 12345;
        const pixels = window.circleFixture(256, 256, () => {});
        for (let i = 0; i < pixels.length; i += 4) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; pixels[i] = pixels[i+1] = pixels[i+2] = state >>> 24; }
        return !detectCircle(pixels, 256, 256, 0.25, 0.6);
    })()`);
    await evaluate(`(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 768;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1024, 768);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(500, 360, 260, 0, Math.PI * 2); ctx.fill();
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        handleFileSelect(new File([blob], 'circle.png', { type: 'image/png' })); return true;
    })()`);
    await waitFor("sourceMedia?.tagName === 'IMG' && sourceCanvas.width === 1024 && sourceCanvas.height === 768 && initialAutoAlignMediaId === null && !autoAlignJob");
    await check('Auto align maps a confirmed circle back to full source coordinates', `(async () => {
        return await runAutoDetect() === true && Math.hypot(ball.x - 500, ball.y - 360) < 10 && Math.abs(ball.r - 260) < 10;
    })()`);
    await evaluate(`(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d'), image = ctx.createImageData(256, 256);
        for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
            const i = (y * 256 + x) * 4; image.data.set([x, y, 64, 255], i);
        }
        ctx.putImageData(image, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        handleFileSelect(new File([blob], 'coordinates.png', { type: 'image/png' })); return true;
    })()`);
    await waitFor("sourceMedia?.tagName === 'IMG' && sourceCanvas.width === 256 && sourceCanvas.height === 256 && initialAutoAlignMediaId === null && !autoAlignJob");
    await check('failed Auto align preserves manual alignment', `(async () => {
        const before = { x: 120, y: 110, r: 75 }; Object.assign(ball, before);
        return await runAutoDetect() === false && JSON.stringify(ball) === JSON.stringify(before) && toastContainer.lastElementChild.innerText.includes('alignment kept');
    })()`);
    await evaluate(`Object.assign(ball, { x: 128, y: 128, r: 90 }); widthInput.value = 256; fovSlider.value = 360; showSourceToggle.checked = false;
        window.readProjectionPixel = (x, y) => {
            const gl = procRenderer.getContext(), pixel = new Uint8Array(4);
            gl.readPixels(x, procCanvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            return Array.from(pixel);
        };
        window.expectedMirrorPixel = (x, y, pitch, yaw, roll) => {
            const latitude = Math.PI / 2 - (y + 0.5) / 128 * Math.PI, longitude = (x + 0.5) / 256 * Math.PI * 2 - Math.PI;
            let [dx, dy, dz] = [Math.cos(latitude) * Math.sin(longitude), -Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude)];
            const rad = degrees => degrees * Math.PI / 180;
            let s = Math.sin(rad(roll)), c = Math.cos(rad(roll)); [dx, dy] = [c*dx - s*dy, s*dx + c*dy];
            s = Math.sin(rad(pitch)); c = Math.cos(rad(pitch)); [dy, dz] = [c*dy - s*dz, s*dy + c*dz];
            s = Math.sin(rad(yaw)); c = Math.cos(rad(yaw)); [dx, dz] = [c*dx + s*dz, -s*dx + c*dz];
            // A reflecting sphere's normal bisects the view and environment directions.
            const normalLength = Math.hypot(dx, dy, dz + 1);
            return [128 + 90 * dx / normalLength - 0.5, 128 + 90 * dy / normalLength - 0.5, 64, 255];
        }; true;`);
    for (const [pitch, yaw, roll] of [[0, 0, 0], [0, 90, 0], [45, 0, 0], [0, 0, 90], [30, -45, 60]]) {
        await check(`GPU projection matches sphere-reflection reference at rotation ${pitch}/${yaw}/${roll}`, `(() => {
            pitchSlider.value = ${pitch}; yawSlider.value = ${yaw}; rollSlider.value = ${roll}; updateParams(); renderProcessor();
            for (const [x, y] of [[64,64], [128,64], [192,64], [128,16], [128,112], [32,32], [224,96]]) {
                const actual = window.readProjectionPixel(x, y), expected = window.expectedMirrorPixel(x, y, ${pitch}, ${yaw}, ${roll});
                if (actual.some((value, i) => Math.abs(value - expected[i]) > 2)) throw new Error(JSON.stringify({ x, y, actual, expected }));
            }
            return true;
        })()`);
    }
    await check('longitude seam and north/south orientation remain consistent', `(() => {
        pitchSlider.value = yawSlider.value = rollSlider.value = 0; updateParams(); renderProcessor();
        for (const y of [16, 32, 96, 112]) {
            const left = window.readProjectionPixel(0, y), right = window.readProjectionPixel(255, y);
            if (left.some((value, i) => Math.abs(value - right[i]) > 4)) return false;
        }
        return window.readProjectionPixel(128, 0)[1] < 128 && window.readProjectionPixel(128, 127)[1] > 128;
    })()`);
    await check('the default 360 preview faces the center of the unwrapped image', `(() => {
        lon = lat = 0; render3D();
        const gl = renderer.getContext(), pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(renderer.domElement.width / 2), Math.floor(renderer.domElement.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return Math.abs(pixel[0] - 128) <= 3 && Math.abs(pixel[1] - 128) <= 3 && pixel[2] === 64;
    })()`);
    await check('blind spots stay black unless synthetic fill is selected', `(() => {
        fovSlider.value = 180; updateParams(); renderProcessor();
        const black = window.readProjectionPixel(8, 64), front = window.readProjectionPixel(128, 64);
        showSourceToggle.checked = true; updateParams(); renderProcessor();
        const filled = window.readProjectionPixel(8, 64);
        return black.slice(0, 3).every(value => value === 0) && front[2] === 64 && filled[2] === 64;
    })()`);
    await check('sampling beyond the source image is black rather than an edge streak', `(() => {
        fovSlider.value = 360; ball.x = 5; updateParams(); renderProcessor();
        return window.readProjectionPixel(64, 64).slice(0, 3).every(value => value === 0);
    })()`);
    await check('the exact rear pole produces a defined sample without a division by zero', `(() => {
        ball.x = 128; updateParams();
        const x = 128, y = 64, theta = (y + 0.5) / 128 * Math.PI - Math.PI / 2, phi = (x + 0.5) / 256 * Math.PI * 2 - Math.PI;
        const direction = new THREE.Vector3(Math.cos(theta) * Math.sin(phi), Math.sin(theta), Math.cos(theta) * Math.cos(phi));
        const rotation = new THREE.Quaternion().setFromUnitVectors(direction, new THREE.Vector3(0, 0, -1));
        procMaterial.uniforms.uRotation.value = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(rotation));
        renderProcessor(); const pixel = window.readProjectionPixel(x, y);
        const error = procRenderer.getContext().getError();
        if (pixel[2] !== 64 || pixel[3] !== 255 || error !== 0) throw new Error(JSON.stringify({ pixel, error }));
        return true;
    })()`);
    await evaluate('fovSlider.value = 360; pitchSlider.value = yawSlider.value = rollSlider.value = 0; showSourceToggle.checked = true; true;');
    await loadImage();
}
