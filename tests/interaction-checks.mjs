export async function runInteractionChecks({ cdp, evaluate, check, waitFor, loadImage, delay }) {
    const key = async (key, code = key, windowsVirtualKeyCode = 0, modifiers = 0) => {
        const text = key === 'Enter' ? '\r' : key.length === 1 ? key : undefined;
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers, text });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };
    await check('collapse arrows toggle once and keep hidden controls out of keyboard focus', `(() => {
        for (const header of document.querySelectorAll('.panel-header')) {
            const button = header.querySelector('button'), content = header.nextElementSibling;
            button.focus(); button.click();
            if (button.getAttribute('aria-expanded') !== 'false' || !content.inert || !content.classList.contains('collapsed')) return false;
            content.querySelector('input, button, canvas')?.focus();
            if (document.activeElement !== button) return false;
            button.click();
            if (button.getAttribute('aria-expanded') !== 'true' || content.inert || content.classList.contains('collapsed')) return false;
        }
        return true;
    })()`);
    await evaluate("document.querySelector('#panel-import .toggle-btn').focus(); true;");
    await key('Enter', 'Enter', 13);
    await check('collapse buttons respond to Enter', "document.querySelector('#panel-import .toggle-btn').getAttribute('aria-expanded') === 'false'");
    await key(' ', 'Space', 32);
    await check('collapse buttons respond to Space', "document.querySelector('#panel-import .toggle-btn').getAttribute('aria-expanded') === 'true'");
    await delay(350);
    await check('icon buttons and form controls have accessible names', `(() => {
        const buttons = [...document.querySelectorAll('button')].every(button => button.getAttribute('aria-label') || button.textContent.trim());
        const inputs = [...document.querySelectorAll('input, select')].every(input => input.getAttribute('aria-label') || [...input.labels].some(label => label.textContent.trim()));
        return buttons && inputs;
    })()`);
    await evaluate('toggleDetectConfig.click(); true;');
    await check('detection settings expose their expanded state', "toggleDetectConfig.getAttribute('aria-expanded') === 'true' && !detectConfigPanel.classList.contains('hidden')");
    await key('Escape', 'Escape', 27);
    await check('Escape closes detection settings and returns focus to its button', "toggleDetectConfig.getAttribute('aria-expanded') === 'false' && document.activeElement === toggleDetectConfig");
    await evaluate(`window.originalBall = { ...ball }; sourceCanvas.focus(); true;`);
    await key('ArrowRight', 'ArrowRight', 39);
    await key('ArrowUp', 'ArrowUp', 38, 8);
    await check('keyboard arrows move the circle and Shift+arrows resize it',
        'ball.x === window.originalBall.x + 1 && ball.r === window.originalBall.r + 1 && alignmentStatus.textContent.includes("Radius")');
    await key('+', 'Equal', 187, 8);
    await check('keyboard zoom is available on the source canvas', 'viewScale > 1');
    await key('0', 'Digit0', 48);
    await check('keyboard view reset preserves the circle alignment', 'viewScale === 1 && viewOffset.x === 0 && viewOffset.y === 0 && ball.x === window.originalBall.x + 1');
    await evaluate('Object.assign(ball, window.originalBall); updateParams(); sourceCanvas.scrollIntoView({ block: "center" }); true;');
    let position = await evaluate(`(() => { const r = sourceCanvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, right: r.right }; })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.right + 20, y: position.y, button: 'left', buttons: 1 });
    await check('source pointer capture continues a drag outside the canvas', 'isDragging && ball.x > window.originalBall.x && sourceCanvas.hasPointerCapture(sourcePointerId)');
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.right + 20, y: position.y, button: 'left', buttons: 0, clickCount: 1 });
    await check('releasing outside the canvas clears the drag state', '!isDragging && !isPanning && sourcePointerId === null && sourcePointers.size === 0');
    await evaluate('Object.assign(ball, window.originalBall); updateParams(); true;');
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: position.x, y: position.y, id: 1 }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: position.x + 20, y: position.y, id: 1 }] });
    await check('touch dragging moves the circle', 'ball.x > window.originalBall.x && isDragging');
    await cdp('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await check('a canceled touch cannot leave the canvas dragging', '!isDragging && !isPanning && sourcePointers.size === 0');
    await evaluate('Object.assign(ball, window.originalBall); updateParams(); true;');
    const points = [{ x: position.x - 40, y: position.y, id: 1 }, { x: position.x + 40, y: position.y, id: 2 }];
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points.map((point, index) => ({ ...point, x: point.x + (index ? 20 : -20) })) });
    await check('a two-finger pinch zooms without changing circle alignment',
        "Math.abs(viewScale - 1.5) < 0.05 && Math.abs(ball.x - window.originalBall.x) < 0.01 && Math.abs(ball.r - window.originalBall.r) < 0.01 && !sourceZoomControls.classList.contains('hidden') && sourceZoomValue.textContent === '150%'");
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    await evaluate('sourceCanvas.focus(); true;');
    await key('0', 'Digit0', 48);
    await evaluate('threeContainer.scrollIntoView({ block: "center" }); threeContainer.focus(); lon = lat = 0; true;');
    await key('ArrowRight', 'ArrowRight', 39);
    await key('ArrowUp', 'ArrowUp', 38);
    await check('the 360 preview supports keyboard look controls', 'lon === 2 && lat === 2');
    position = await evaluate(`(() => { const r = threeContainer.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, right: r.right }; })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.right + 15, y: position.y, button: 'left', buttons: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.right + 15, y: position.y, button: 'left', buttons: 0, clickCount: 1 });
    await check('the 360 preview releases pointer capture outside its bounds', 'lon !== 2 && !isUserInteracting && viewerPointerId === null');
    await evaluate(`window.focusButton = document.querySelector('#sourcePanel [data-focus-toggle]'); window.focusButton.focus(); window.focusButton.click(); true;`);
    await check('focus mode is exposed as a dialog', 'focusState !== null && focusState.el.getAttribute("aria-modal") === "true" && window.focusButton.getAttribute("aria-pressed") === "true"');
    await check('the focused source canvas fits its available panel', `(() => {
        const canvas = sourceCanvas.getBoundingClientRect(), container = sourceContainer.getBoundingClientRect();
        return canvas.width <= container.width + 1 && canvas.height <= container.height + 1;
    })()`);
    await key('Tab', 'Tab', 9, 8);
    await check('Shift+Tab keeps keyboard focus inside the focused panel', 'focusState.el.contains(document.activeElement)');
    await key('Escape', 'Escape', 27);
    await check('Escape closes focus mode and restores the invoking button', 'focusState === null && document.activeElement === window.focusButton && window.focusButton.getAttribute("aria-pressed") === "false"');
    await check('loading messages and busy state appear before decoding', `(async () => {
        const blob = await (await fetch('/example/example.jpg')).blob();
        handleFileSelect(new File([blob], 'loading.jpg', { type: 'image/jpeg' }));
        return mediaLoading && sourceContainer.getAttribute('aria-busy') === 'true' && mediaStatus.textContent === 'Loading image…';
    })()`);
    await waitFor("sourceMedia?.tagName === 'IMG' && !mediaLoading");
    await check('successful decoding clears the loading message and busy state', "mediaStatus.classList.contains('hidden') && sourceContainer.getAttribute('aria-busy') === 'false'");
    await check('stalled loading leaves a persistent error and restores a usable state', `(() => {
        const originalTimer = window.setTimeout; let timeout;
        window.setTimeout = (callback, ms, ...args) => { if (ms === 30000) timeout = callback; return originalTimer(callback, ms, ...args); };
        try { const id = resetMedia(); beginMediaLoad(id, 'Loading video…'); timeout(); }
        finally { window.setTimeout = originalTimer; }
        return !mediaLoading && !sourceMedia && !mediaStatus.classList.contains('hidden') && mediaStatus.textContent.includes('Loading stopped') && sourceContainer.getAttribute('aria-busy') === 'false';
    })()`);
    await loadImage();
    await evaluate('lon = lat = 0; window.scrollTo(0, 0); true;');
}
