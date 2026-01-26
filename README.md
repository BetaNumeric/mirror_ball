[**Live Demo**](betanumeric.github.io/mirror_ball/)

# **Mirror Ball Unwrapper**

Mirror Ball Unwrapper is a browser-based utility designed to convert circular fisheye or mirror ball imagery into equirectangular maps. It is built to handle both static images and video files using WebGL for real-time processing and transformation.

## **Overview**

The tool operates by mapping pixels from a circular source onto a spherical projection. Users can manually align the source circle to match their media and adjust optical parameters like coverage angle and world rotation.

### **Main Features**

The application supports image and video uploads, providing an interactive 3D viewer to preview the results in a spherical environment. For video content, the tool can export processed frames as a ZIP sequence. It also includes an auto-detection feature to assist with initial selection alignment.

## **Technical Details**

This project is a single-file web application that relies on the following libraries:

* Three.js for WebGL processing and 3D rendering.  
* Tailwind CSS for the user interface layout.  
* JSZip and FileSaver.js for handling sequence exports.

All processing is performed locally in the browser; no data is uploaded to a server.
