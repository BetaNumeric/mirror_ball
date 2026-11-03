[**Live Demo**](https://betanumeric.github.io/mirror_ball/)

# **Mirror Ball Unwrapper**

Mirror Ball Unwrapper is a browser-based utility designed to convert circular fisheye or mirror ball imagery into equirectangular maps. It is built to handle both static images and video files using WebGL for real-time processing and transformation.

## **Overview**

The tool operates by mapping pixels from a circular source onto a spherical projection. Users can manually align the source circle to match their media and adjust optical parameters like coverage angle and world rotation.

### **Main Features**

The application supports image and video uploads, providing an interactive 3D viewer to preview the results in a spherical environment. For video content, the tool can export processed frames as a ZIP sequence. It also includes an auto-detection feature to assist with initial selection alignment.

## **Technical Details**

Open `index.html` in a browser, keeping `auto-align.js` beside it. The application uses:

* Three.js for WebGL processing and 3D rendering.  
* JSZip and FileSaver.js for handling sequence exports.

All processing is performed locally in the browser; no data is uploaded to a server.

## **Alignment and Preview Controls**

Open **Controls** below the source image for a compact shortcut reference.

* On wide screens, drag the divider between Source and Result to resize the panes. Arrow keys adjust a focused divider; Home/End set the limits, and 0, Enter, or a double-click restores equal widths. Narrow screens keep a stacked layout.
* Drag inside the source circle to move it, or drag a handle or its edge to resize. Drag outside the circle to pan.
* Scroll or pinch with two fingers to zoom the source. Circle handles keep a usable size as the display or zoom changes.
* The active resize handle grows and gains an outline while dragging. A zoom percentage and **Reset** appear when zoomed; percentages are relative to the fitted source view. Reset restores zoom and pan without changing alignment.
* Focus the source canvas with Tab: arrow keys move the circle, Shift+arrows resize it, +/− zoom, and 0 resets the view. Alt+arrows use larger alignment steps.
* Drag the 360° preview with a mouse, pen, or finger. Its arrow keys look around; Shift uses larger turns, and 0 resets the viewing direction.
* Collapse buttons work with Enter and Space. Escape closes detection settings or Focus Mode and returns keyboard focus.

**Auto align** compares several circle candidates, samples their boundaries at higher resolution, and uses robust fitting to reduce the influence of glare, clutter, and partial occlusion. Boundary coverage, fit error, and competing candidates determine whether to apply a result. Uncertain results preserve the current alignment.

If several circles look plausible, roughly position the circle yourself and enable **Prefer current circle** in the detection settings. This hint chooses between supported candidates; it still requires a visible rim. Click **Cancel align**, move or resize the circle, or change media to cancel a running job. Export also cancels alignment before processing frames.

Detection runs in a local background worker, with a bounded fallback if workers are unavailable. Images are refined at up to a 1536-pixel long edge. Video and webcam alignment use one captured frame and leave playback alone; they do not track a moving ball over time. Confidence is a heuristic, not a probability, and heavy occlusion or an elliptical boundary may require manual alignment.

The projection uses a radius proportional to `sin(angle / 2)`; the blind-spot fill stretches source pixels into missing coverage.

Loading and decoding errors remain visible in Media. A load that makes no progress for 30 seconds reports an error so another file can be selected.

## **Development Checks**

Run the dependency-free detector tests with Node.js 22 or later:

```sh
node tests/auto-align.test.cjs
node tests/auto-align.test.cjs --benchmark
```

The fixtures use analytic circle coordinates, fractional centres, cropping, glare, texture, occlusion, competing circles, and negative shapes/noise. The benchmark reports coordinate errors, false accepts/rejects, and timings for this synthetic corpus; these are not real-photo accuracy measurements.

Run the browser regression checks with Chrome or Chromium installed:

```sh
node tests/browser-regressions.mjs
```

Set `CHROME_PATH` if the browser is installed in a custom location. The checks use a temporary browser profile, a simulated camera, and a generated video clip. Internet access is required to load the application's CDN libraries.

Set `MIRROR_BALL_TEST_VIDEO` to a local video path to also test importing, playback, and paused seeking with that file at its full source resolution.

The suite checks GPU pixels against a sphere-reflection reference, detection and worker cancellation/failure recovery, native pointer and keyboard interaction, video/export regressions, and opening the app directly from disk.

Sequence export accepts 1–120 FPS, supports cancellation, and stops if encoded frames exceed 256 MB. Use a lower output resolution or a shorter clip for larger exports.
