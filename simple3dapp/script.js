// Simple 3D application inspired by Blender.  This script manages the scene,
// objects, modes (free, edit, animation, texture) and user interactions.
// This file assumes that three.min.js has been included on the page, so
// `THREE` is available globally. We implement a basic orbit controller and
// avoid using ES modules so the app runs properly when opened from the
// filesystem without a local web server.

/* Scene setup */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

// Renderer setup
const rendererContainer = document.getElementById('renderer-container');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(rendererContainer.clientWidth, rendererContainer.clientHeight);
rendererContainer.appendChild(renderer.domElement);

// Camera setup
const camera = new THREE.PerspectiveCamera(
  45,
  rendererContainer.clientWidth / rendererContainer.clientHeight,
  0.1,
  1000
);
// Camera spherical coordinates for orbiting
let orbitRadius = 20;
let orbitAzimuth = Math.PI / 4; // horizontal angle
let orbitPolar = Math.PI / 4; // vertical angle
const orbitTarget = new THREE.Vector3(0, 0, 0);

// Update camera position based on spherical coordinates
function updateCameraPosition() {
  const sinP = Math.sin(orbitPolar);
  const cosP = Math.cos(orbitPolar);
  const sinA = Math.sin(orbitAzimuth);
  const cosA = Math.cos(orbitAzimuth);
  camera.position.set(
    orbitTarget.x + orbitRadius * sinP * cosA,
    orbitTarget.y + orbitRadius * cosP,
    orbitTarget.z + orbitRadius * sinP * sinA
  );
  camera.lookAt(orbitTarget);
}

updateCameraPosition();

// Variables for manual orbit control
let isOrbiting = false;
let lastPointerX = 0;
let lastPointerY = 0;

// Event listeners for manual orbit control
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 2) {
    // right mouse button to orbit
    isOrbiting = true;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (isOrbiting) {
    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    orbitAzimuth -= dx * 0.005;
    orbitPolar -= dy * 0.005;
    // clamp polar angle to avoid flipping
    const minPolar = 0.1;
    const maxPolar = Math.PI - 0.1;
    orbitPolar = Math.max(minPolar, Math.min(maxPolar, orbitPolar));
    updateCameraPosition();
  }
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button === 2) {
    isOrbiting = false;
  }
});
renderer.domElement.addEventListener('wheel', (e) => {
  // Zoom in/out with mouse wheel
  orbitRadius *= 1 + e.deltaY * 0.001;
  orbitRadius = Math.max(2, Math.min(100, orbitRadius));
  updateCameraPosition();
});

// Add a grid helper to provide a ground plane reference
const gridHelper = new THREE.GridHelper(50, 50);
scene.add(gridHelper);

// Basic lighting: ambient and directional
const ambient = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambient);
const directional = new THREE.DirectionalLight(0xffffff, 0.8);
directional.position.set(5, 10, 7);
scene.add(directional);

/* Global variables */
let objects = []; // All objects in the scene that can be selected
let selectedObject = null; // Currently selected mesh
let currentMode = 'free'; // free, edit, animation, texture
let faceSelection = null; // { object, faceIndex } for texture mode

// Animation variables
const totalFrames = 300;
let currentFrame = 0;
let animationPlaying = false;
let animationStartTime = 0;
let fps = 30;
let mediaRecorder = null;
let recordedChunks = [];

/* DOM elements */
const sidebar = document.getElementById('sidebar');
const settingsPanel = document.getElementById('settingsPanel');
const editSettings = document.getElementById('editSettings');
const animationSettings = document.getElementById('animationSettings');
const textureSettings = document.getElementById('textureSettings');
const freeModeBtn = document.getElementById('freeModeBtn');
const editModeBtn = document.getElementById('editModeBtn');
const animModeBtn = document.getElementById('animModeBtn');
const textureModeBtn = document.getElementById('textureModeBtn');
const timelineSlider = document.getElementById('timelineSlider');

// Transform input fields
const posXField = document.getElementById('posX');
const posYField = document.getElementById('posY');
const posZField = document.getElementById('posZ');
const rotXField = document.getElementById('rotX');
const rotYField = document.getElementById('rotY');
const rotZField = document.getElementById('rotZ');
const scaleXField = document.getElementById('scaleX');
const scaleYField = document.getElementById('scaleY');
const scaleZField = document.getElementById('scaleZ');

/* Utility functions */

// Convert degrees to radians
function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

// Convert radians to degrees
function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

// Clear selection and detach transform controls
function deselectObject() {
  if (selectedObject) {
  }
  selectedObject = null;
  faceSelection = null;
  updateTransformFields();
}

// Select an object and attach transform controls if appropriate
function selectObject(object) {
  if (selectedObject === object) return;
  deselectObject();
  selectedObject = object;
  if (!object) {
    return;
  }
  updateTransformFields();
}

// Update transform input fields based on the selected object's transform
function updateTransformFields() {
  if (!selectedObject) {
    posXField.value = '';
    posYField.value = '';
    posZField.value = '';
    rotXField.value = '';
    rotYField.value = '';
    rotZField.value = '';
    scaleXField.value = '';
    scaleYField.value = '';
    scaleZField.value = '';
    return;
  }
  posXField.value = selectedObject.position.x.toFixed(2);
  posYField.value = selectedObject.position.y.toFixed(2);
  posZField.value = selectedObject.position.z.toFixed(2);
  rotXField.value = radToDeg(selectedObject.rotation.x).toFixed(0);
  rotYField.value = radToDeg(selectedObject.rotation.y).toFixed(0);
  rotZField.value = radToDeg(selectedObject.rotation.z).toFixed(0);
  scaleXField.value = selectedObject.scale.x.toFixed(2);
  scaleYField.value = selectedObject.scale.y.toFixed(2);
  scaleZField.value = selectedObject.scale.z.toFixed(2);
}

// Apply transform values from the input fields to the selected object
function applyTransform() {
  if (!selectedObject) return;
  const px = parseFloat(posXField.value);
  const py = parseFloat(posYField.value);
  const pz = parseFloat(posZField.value);
  const rx = degToRad(parseFloat(rotXField.value));
  const ry = degToRad(parseFloat(rotYField.value));
  const rz = degToRad(parseFloat(rotZField.value));
  const sx = parseFloat(scaleXField.value);
  const sy = parseFloat(scaleYField.value);
  const sz = parseFloat(scaleZField.value);
  if (!isNaN(px)) selectedObject.position.x = px;
  if (!isNaN(py)) selectedObject.position.y = py;
  if (!isNaN(pz)) selectedObject.position.z = pz;
  if (!isNaN(rx)) selectedObject.rotation.x = rx;
  if (!isNaN(ry)) selectedObject.rotation.y = ry;
  if (!isNaN(rz)) selectedObject.rotation.z = rz;
  if (!isNaN(sx) && sx !== 0) selectedObject.scale.x = sx;
  if (!isNaN(sy) && sy !== 0) selectedObject.scale.y = sy;
  if (!isNaN(sz) && sz !== 0) selectedObject.scale.z = sz;

  // After applying transforms, refresh the UI fields to reflect the
  // actual transform values on the object.  This helps verify that
  // transformations have been applied correctly.
  updateTransformFields();

  // After applying transforms, no additional debug actions are needed here.
}

// Create primitives
function createPrimitive(type) {
  let mesh;
  switch (type) {
    case 'box': {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshStandardMaterial({ color: 0x0078d4 });
      mesh = new THREE.Mesh(geometry, material);
      break;
    }
    case 'sphere': {
      const geometry = new THREE.SphereGeometry(0.6, 32, 32);
      const material = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
      mesh = new THREE.Mesh(geometry, material);
      break;
    }
    case 'plane': {
      const geometry = new THREE.PlaneGeometry(2, 2);
      const material = new THREE.MeshStandardMaterial({ color: 0x5555ff, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(geometry, material);
      break;
    }
    case 'terrain': {
      // Create a simple plane with more subdivisions to simulate a terrain
      const geometry = new THREE.PlaneGeometry(5, 5, 20, 20);
      geometry.rotateX(-Math.PI / 2);
      // Raise some vertices for variation
      const positionAttr = geometry.attributes.position;
      for (let i = 0; i < positionAttr.count; i++) {
        const y = 0.2 * Math.sin(i / 5);
        positionAttr.setY(i, y);
      }
      positionAttr.needsUpdate = true;
      const material = new THREE.MeshStandardMaterial({ color: 0x228822, side: THREE.DoubleSide, flatShading: true });
      mesh = new THREE.Mesh(geometry, material);
      break;
    }
    case 'camera': {
      // Add an additional perspective camera object to the scene; represent it as a small box
      const geometry = new THREE.BoxGeometry(0.4, 0.3, 0.6);
      const material = new THREE.MeshStandardMaterial({ color: 0xaaaa00 });
      mesh = new THREE.Mesh(geometry, material);
      mesh.userData.isCamera = true;
      // Create a real camera and link it to this mesh
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      cam.position.set(0, 1, -2);
      mesh.add(cam);
      mesh.userData.camera = cam;
      break;
    }
    default:
      return;
  }
  mesh.position.set(0, 0.5, 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  objects.push(mesh);
  selectObject(mesh);
}

// Handle file import for images (texture planes)
const imageInput = document.getElementById('imageInput');
imageInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const textureLoader = new THREE.TextureLoader();
  textureLoader.load(url, (tex) => {
    const imgWidth = tex.image.width;
    const imgHeight = tex.image.height;
    const aspect = imgWidth / imgHeight;
    const width = 2;
    const height = 2 / aspect;
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.set(0, 1, 0);
    scene.add(plane);
    objects.push(plane);
    selectObject(plane);
  });
  imageInput.value = '';
});

// Handle adding new primitives from sidebar
document.querySelectorAll('.add-object').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.getAttribute('data-primitive');
    createPrimitive(type);
  });
});

// Mode switching handlers
function setMode(mode) {
  currentMode = mode;
  // Remove active class from all buttons
  document.querySelectorAll('.mode-button').forEach((btn) => btn.classList.remove('active'));
  switch (mode) {
    case 'free':
      freeModeBtn.classList.add('active');
      sidebar.hidden = false;
      settingsPanel.hidden = true;
      // nothing specific to set
      break;
    case 'edit':
      editModeBtn.classList.add('active');
      sidebar.hidden = true;
      settingsPanel.hidden = false;
      editSettings.hidden = false;
      animationSettings.hidden = true;
      textureSettings.hidden = true;
      // nothing specific to set
      break;
    case 'animation':
      animModeBtn.classList.add('active');
      sidebar.hidden = true;
      settingsPanel.hidden = false;
      editSettings.hidden = true;
      animationSettings.hidden = false;
      textureSettings.hidden = true;
      // nothing specific to set
      break;
    case 'texture':
      textureModeBtn.classList.add('active');
      sidebar.hidden = false;
      settingsPanel.hidden = false;
      editSettings.hidden = true;
      animationSettings.hidden = true;
      textureSettings.hidden = false;
      // nothing specific to set
      break;
  }
}

freeModeBtn.addEventListener('click', () => setMode('free'));
editModeBtn.addEventListener('click', () => setMode('edit'));
animModeBtn.addEventListener('click', () => setMode('animation'));
textureModeBtn.addEventListener('click', () => setMode('texture'));

// Apply transform button
document.getElementById('applyTransform').addEventListener('click', () => {
  applyTransform();
});

// Global color application
document.getElementById('applyGlobalColor').addEventListener('click', () => {
  if (!selectedObject) return;
  const colorVal = document.getElementById('globalColor').value;
  if (selectedObject.material) {
    // If material supports color property
    if (Array.isArray(selectedObject.material)) {
      selectedObject.material.forEach((mat) => {
        if (mat.color) mat.color.set(colorVal);
      });
    } else if (selectedObject.material.color) {
      selectedObject.material.color.set(colorVal);
    }
    selectedObject.material.needsUpdate = true;
  }
});

// Apply color to a specific face
document.getElementById('applyFaceColor').addEventListener('click', () => {
  if (!selectedObject || !faceSelection || faceSelection.object !== selectedObject) return;
  const colorVal = document.getElementById('faceColor').value;
  const mesh = selectedObject;
  // Ensure geometry is non-indexed for per-face coloring
  let geometry = mesh.geometry;
  if (geometry.index) {
    geometry = geometry.toNonIndexed();
    mesh.geometry = geometry;
  }
  const colorAttr = geometry.attributes.color;
  const posAttr = geometry.attributes.position;
  if (!colorAttr) {
    // If there is no color attribute, initialize it and fill with the
    // mesh's current material color so that all faces inherit the base
    // color instead of defaulting to black. This prevents unpainted faces
    // from turning black when only one face is colored.
    const colors = new Float32Array(posAttr.count * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    let baseColor = new THREE.Color(0xffffff);
    if (Array.isArray(mesh.material)) {
      // choose first material's color as base
      const mat0 = mesh.material.find((m) => m.color);
      if (mat0 && mat0.color) baseColor = mat0.color.clone();
    } else if (mesh.material && mesh.material.color) {
      baseColor = mesh.material.color.clone();
    }
    const colArr = geometry.attributes.color.array;
    for (let vi = 0; vi < posAttr.count; vi++) {
      colArr[vi * 3 + 0] = baseColor.r;
      colArr[vi * 3 + 1] = baseColor.g;
      colArr[vi * 3 + 2] = baseColor.b;
    }
  }
  // Determine which vertices correspond to the face
  const faceIndex = faceSelection.faceIndex;
  const stride = 3;
  const vIndex = faceIndex * 3;
  const selectedColor = new THREE.Color(colorVal);
  const colorArray = geometry.attributes.color.array;
  for (let i = 0; i < 3; i++) {
    colorArray[(vIndex + i) * 3 + 0] = selectedColor.r;
    colorArray[(vIndex + i) * 3 + 1] = selectedColor.g;
    colorArray[(vIndex + i) * 3 + 2] = selectedColor.b;
  }
  geometry.attributes.color.needsUpdate = true;
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((mat) => {
      mat.vertexColors = true;
    });
  } else {
    mesh.material.vertexColors = true;
  }
  mesh.material.needsUpdate = true;
});

// Set up event listeners for canvas picking
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onPointerDown(event) {
  // Only handle picking on left mouse button
  if (event.button !== 0) return;
  // Determine normalized device coordinates relative to renderer
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  // If in texture mode, we want to capture face selection
  if (currentMode === 'texture') {
    const intersects = raycaster.intersectObjects(objects, true);
    if (intersects.length > 0) {
      const hit = intersects[0];
      faceSelection = {
        object: hit.object,
        faceIndex: hit.faceIndex
      };
      selectObject(hit.object);
      return;
    }
  }
  // Otherwise handle regular object selection
  const intersects = raycaster.intersectObjects(objects, true);
  if (intersects.length > 0) {
    // Always select the top-level mesh so transforms apply correctly.  The
    // raycaster returns the deepest child that was hit (for example, a face
    // of a mesh).  Walk up the parent chain until a THREE.Mesh is found.
    let hitObj = intersects[0].object;
    while (hitObj && !hitObj.isMesh) {
      hitObj = hitObj.parent;
    }
    if (hitObj) {
      selectObject(hitObj);
    } else {
      deselectObject();
    }
  } else {
    deselectObject();
  }
}

renderer.domElement.addEventListener('pointerdown', onPointerDown);

// Animation keyframe setting
document.getElementById('setKeyframe').addEventListener('click', () => {
  if (!selectedObject) return;
  const frame = parseInt(timelineSlider.value);
  // Prepare userData store
  const data = selectedObject.userData;
  if (!data.keyframes) data.keyframes = { position: [], rotation: [], scale: [] };
  // Capture transforms
  data.keyframes.position.push({ frame: frame, value: selectedObject.position.clone() });
  data.keyframes.rotation.push({ frame: frame, value: selectedObject.quaternion.clone() });
  data.keyframes.scale.push({ frame: frame, value: selectedObject.scale.clone() });
});

// Interpolates between keyframes
function interpolateKeyframes(keyframes, frame) {
  if (keyframes.length === 0) return null;
  keyframes.sort((a, b) => a.frame - b.frame);
  if (frame <= keyframes[0].frame) return keyframes[0].value;
  if (frame >= keyframes[keyframes.length - 1].frame) return keyframes[keyframes.length - 1].value;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const kf1 = keyframes[i];
    const kf2 = keyframes[i + 1];
    if (frame >= kf1.frame && frame <= kf2.frame) {
      const t = (frame - kf1.frame) / (kf2.frame - kf1.frame);
      if (kf1.value instanceof THREE.Quaternion) {
        const quat = new THREE.Quaternion();
        quat.slerpQuaternions(kf1.value, kf2.value, t);
        return quat;
      }
      // assume Vector3 for other properties
      const v = new THREE.Vector3();
      v.copy(kf1.value).lerp(kf2.value, t);
      return v;
    }
  }
  return null;
}

// Update objects transforms at a specific frame
function updateObjectsAtFrame(frame) {
  objects.forEach((obj) => {
    const kfData = obj.userData.keyframes;
    if (!kfData) return;
    const posVal = interpolateKeyframes(kfData.position, frame);
    const rotVal = interpolateKeyframes(kfData.rotation, frame);
    const scaleVal = interpolateKeyframes(kfData.scale, frame);
    if (posVal) obj.position.copy(posVal);
    if (rotVal) obj.quaternion.copy(rotVal);
    if (scaleVal) obj.scale.copy(scaleVal);
  });
}

// Play animation
document.getElementById('playAnimation').addEventListener('click', () => {
  if (animationPlaying) return;
  animationPlaying = true;
  animationStartTime = performance.now() - (currentFrame * 1000 / fps);
});

// Stop animation playback
document.getElementById('stopAnimation').addEventListener('click', () => {
  animationPlaying = false;
});

// Start/stop recording
document.getElementById('recordVideo').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
});

// Timeline slider change handler
timelineSlider.addEventListener('input', () => {
  const frame = parseInt(timelineSlider.value);
  currentFrame = frame;
  updateObjectsAtFrame(frame);
});

/* Video recording functions */
function startRecording() {
  // When capturing the canvas stream, we use canvas.captureStream as described in articles
  // The resulting stream is recorded via MediaRecorder into a WebM blob. Chrome supports webm, Safari uses mp4【717987018677970†L94-L100】.
  const stream = renderer.domElement.captureStream();
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
  mediaRecorder.ondataavailable = function (e) {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = function () {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'animation.webm';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
    recordedChunks = [];
  };
  mediaRecorder.start();
  // If animation not playing, start playback
  if (!animationPlaying) {
    animationPlaying = true;
    animationStartTime = performance.now() - (currentFrame * 1000 / fps);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

/* Rendering loop */
function animate() {
  requestAnimationFrame(animate);
  // Update animations if playing
  if (animationPlaying) {
    const elapsed = performance.now() - animationStartTime;
    const frame = Math.floor((elapsed / 1000) * fps);
    if (frame <= totalFrames) {
      currentFrame = frame;
      timelineSlider.value = frame;
      updateObjectsAtFrame(frame);
    } else {
      animationPlaying = false;
      // stop recording if reached end
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
      }
    }
  }
  renderer.render(scene, camera);
}

animate();

// Initialize default mode
setMode('free');

// Adjust renderer and camera aspect ratio when the window resizes
window.addEventListener('resize', () => {
  const width = rendererContainer.clientWidth;
  const height = rendererContainer.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  updateCameraPosition();
});