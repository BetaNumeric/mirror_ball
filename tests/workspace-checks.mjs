export async function runWorkspaceChecks({ cdp, evaluate, check, waitFor, loadImage, delay }) {
    const key = async (key, code = key, windowsVirtualKeyCode = 0, modifiers = 0) => {
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers, text: key === 'Enter' ? '\r' : key.length === 1 ? key : undefined });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };
    const mouse = (type, x, y, buttons, clickCount = 1) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount });
    const dividerPosition = () => evaluate(`(() => { workspaceDivider.scrollIntoView({ block: 'center' }); const r = workspaceDivider.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await waitFor('!needsRender && !sourceNeedsRender');
    await check('source zoom controls stay hidden at the fitted view', "sourceZoomControls.classList.contains('hidden') && viewScale === 1");
    await evaluate(`window.workspaceOriginalBall = { ...ball }; window.workspaceOriginalImage = procCanvas.toDataURL();
        window.workspaceOriginalSize = [procCanvas.width, procCanvas.height]; window.workspaceMapVersion = sphereMesh.material.map.version;
        sourceCanvas.scrollIntoView({ block: 'center' }); true;`);
    const sourcePosition = await evaluate(`(() => { const r = sourceCanvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: sourcePosition.x, y: sourcePosition.y, deltaX: 0, deltaY: -100 });
    await waitFor('viewScale > 1 && !sourceNeedsRender');
    await check('wheel zoom reveals its percentage without changing the exported image',
        "!sourceZoomControls.classList.contains('hidden') && sourceZoomValue.textContent === '110%' && JSON.stringify(ball) === JSON.stringify(window.workspaceOriginalBall) && procCanvas.toDataURL() === window.workspaceOriginalImage && sphereMesh.material.map.version === window.workspaceMapVersion");
    await evaluate('resetZoomBtn.focus(); true;');
    await key(' ', 'Space', 32);
    await check('Reset restores zoom and pan, hides itself, and returns focus to the canvas',
        "viewScale === 1 && viewOffset.x === 0 && viewOffset.y === 0 && sourceZoomControls.classList.contains('hidden') && document.activeElement === sourceCanvas");
    await evaluate(`window.sourcePaneWidth = document.getElementById('sourcePanel').getBoundingClientRect().width;
        window.resultPaneWidth = document.getElementById('resultPanel').getBoundingClientRect().width; true;`);
    let position = await dividerPosition();
    await mouse('mousePressed', position.x, position.y, 1);
    await mouse('mouseMoved', position.x + 60, position.y, 1);
    await check('dragging the divider resizes both panes and exposes the new proportion',
        "document.getElementById('sourcePanel').getBoundingClientRect().width > window.sourcePaneWidth && document.getElementById('resultPanel').getBoundingClientRect().width < window.resultPaneWidth && Number(workspaceDivider.getAttribute('aria-valuenow')) > 50 && workspaceDivider.hasPointerCapture(splitPointerId)");
    await mouse('mouseReleased', position.x + 60, position.y, 0);
    await waitFor('!sourceNeedsRender');
    await check('pane resizing leaves alignment and output dimensions and pixels unchanged',
        "splitPointerId === null && !document.body.classList.contains('is-resizing-panes') && JSON.stringify(ball) === JSON.stringify(window.workspaceOriginalBall) && procCanvas.width === window.workspaceOriginalSize[0] && procCanvas.height === window.workspaceOriginalSize[1] && procCanvas.toDataURL() === window.workspaceOriginalImage");
    await key('Home', 'Home', 36);
    await check('the divider enforces a usable source pane minimum',
        "document.getElementById('sourcePanel').getBoundingClientRect().width >= 259 && Number(workspaceDivider.getAttribute('aria-valuenow')) === Number(workspaceDivider.getAttribute('aria-valuemin'))");
    await key('End', 'End', 35);
    await check('the divider enforces a usable result pane minimum',
        "document.getElementById('resultPanel').getBoundingClientRect().width >= 219 && Number(workspaceDivider.getAttribute('aria-valuenow')) === Number(workspaceDivider.getAttribute('aria-valuemax'))");
    await key('0', 'Digit0', 48);
    await key('ArrowRight', 'ArrowRight', 39, 8);
    await check('keyboard divider resizing supports larger steps', "Math.abs(workspaceRatio - 0.6) < 0.001 && workspaceDivider.getAttribute('aria-valuetext').includes('Source 60 percent')");
    position = await dividerPosition();
    await mouse('mousePressed', position.x, position.y, 1, 2);
    await mouse('mouseReleased', position.x, position.y, 0, 2);
    await check('double-clicking the divider restores equal panes', 'Math.abs(workspaceRatio - 0.5) < 0.001');
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    position = await dividerPosition();
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: position.x, y: position.y, id: 1 }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: position.x + 20, y: position.y, id: 1 }] });
    await check('the divider supports touch dragging', 'splitPointerId !== null && workspaceRatio > 0.5');
    await cdp('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await check('canceling a divider drag clears capture and resize styling', "splitPointerId === null && !document.body.classList.contains('is-resizing-panes') && !workspaceDivider.classList.contains('is-active')");
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    await evaluate('updateWorkspaceSplit(0.5); resetSourceView(); sourceCanvas.scrollIntoView({ block: "center" }); true;');
    await waitFor('!needsRender && !sourceNeedsRender');
    position = await evaluate(`(() => {
        const r = sourceCanvas.getBoundingClientRect(), handle = getAlignmentHandles()[0];
        window.handlePatch = () => {
            const size = Math.ceil(sourceCanvas.width / sourceCanvas.getBoundingClientRect().width * 13);
            return ctxSource.getImageData(Math.floor(handle.x * viewScale + viewOffset.x - size), Math.floor(handle.y * viewScale + viewOffset.y - size), size * 2, size * 2).data;
        };
        // Settle Canvas2D's readback backend before comparing antialiased drawing.
        for (let i = 0; i < 4; i++) { window.handlePatch(); drawUI(); }
        window.idleHandlePixels = Array.from(window.handlePatch());
        window.handleOutput = procCanvas.toDataURL();
        return { x: r.left + handle.x / sourceCanvas.width * r.width, y: r.top + handle.y / sourceCanvas.height * r.height };
    })()`);
    await mouse('mousePressed', position.x, position.y, 1);
    await waitFor('!sourceNeedsRender');
    await check('pressing a resize handle draws a distinct active handle without altering output',
        "isDragging && dragMode === 'resize-right' && window.handlePatch().some((value, i) => value !== window.idleHandlePixels[i]) && procCanvas.toDataURL() === window.handleOutput");
    await mouse('mouseReleased', position.x, position.y, 0);
    await waitFor('!sourceNeedsRender');
    await check('releasing a handle removes its active drawing immediately', `(() => {
        const pixels = window.handlePatch(), differences = pixels.reduce((sum, value, i) => sum + (value !== window.idleHandlePixels[i] ? 1 : 0), 0);
        const largeDifferences = pixels.reduce((sum, value, i) => sum + (Math.abs(value - window.idleHandlePixels[i]) > 16 ? 1 : 0), 0);
        if (isDragging || differences) throw new Error(JSON.stringify({ isDragging, differences, largeDifferences, ball, before: window.workspaceOriginalBall, scale: viewScale }));
        return true;
    })()`);
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: position.x, y: position.y, id: 1 }] });
    await waitFor('!sourceNeedsRender');
    await cdp('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await waitFor('!sourceNeedsRender');
    await check('canceling a handle drag also clears its active drawing',
        '!isDragging && sourcePointers.size === 0 && window.handlePatch().every((value, i) => value === window.idleHandlePixels[i])');
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    await evaluate('updateWorkspaceSplit(0.7); workspaceDivider.focus(); true;');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    await check('narrow screens stack the panes and remove the divider from keyboard focus', `(() => {
        const source = document.getElementById('sourcePanel').getBoundingClientRect(), result = document.getElementById('resultPanel').getBoundingClientRect();
        workspaceDivider.focus();
        return getComputedStyle(workspaceDivider).display === 'none' && document.activeElement !== workspaceDivider && result.top >= source.bottom && document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    })()`);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    await check('returning to a wide layout retains the pane proportion', 'Math.abs(workspaceRatio - 0.7) < 0.001');
    await evaluate('zoomSource({ x: sourceCanvas.width / 2, y: sourceCanvas.height / 2 }, 2); true;');
    await loadImage();
    await check('new media resets contextual zoom while retaining the workspace split',
        "Math.abs(workspaceRatio - 0.7) < 0.001 && viewScale === 1 && sourceZoomControls.classList.contains('hidden')");
    await evaluate('updateWorkspaceSplit(0.5); true;');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    await evaluate('window.scrollTo(0, 0); true;');
}
