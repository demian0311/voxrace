import * as THREE from 'three';

// --- Configuration ---
const VOXEL_SIZE = 5;
const CHUNK_SIZE = 10;
const DRAW_DISTANCE = 12;
const TANK_SPEED = 30;
const ENEMY_SPEED = 4;
const TANK_ROTATION_SPEED = 2;
const PROJECTILE_SPEED = 30;
const PLAYER_PROJECTILE_SPEED = 45;
const FIRE_COOLDOWN = 2.0; // Seconds
const ENEMY_FIRE_COOLDOWN = 5.0;
const RADAR_RANGE = 150;
const MAX_HEALTH = 5;
let isGameOver = false;
let isPaused = false;
let killCount = 0;
let gameStartTime = 0;

// --- Scene Setup ---
const scene = new THREE.Scene();
const HORIZON_COLOR = 0x88C0D0; // Nord8 (Frost)
const SKY_COLOR = 0x2E3440; // Nord0 (Polar Night)
const FOG_COLOR = 0x2E3440; // Nord0 (Dark)

scene.fog = new THREE.FogExp2(FOG_COLOR, 0.005);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 20, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// --- UI: Radar ---
const radarCanvas = document.createElement('canvas');
radarCanvas.width = 200;
radarCanvas.height = 200;
radarCanvas.style.position = 'absolute';
radarCanvas.style.top = '20px';
radarCanvas.style.left = '20px';
radarCanvas.style.width = '150px';
radarCanvas.style.height = '150px';
radarCanvas.style.borderRadius = '50%';
radarCanvas.style.backgroundColor = 'rgba(46, 52, 64, 0.8)'; // Nord0
radarCanvas.style.border = '2px solid #88C0D0'; // Nord8
document.body.appendChild(radarCanvas);

const radarCtx = radarCanvas.getContext('2d');

function updateRadar() {
    const width = radarCanvas.width;
    const height = radarCanvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const scale = (width / 2) / RADAR_RANGE;
    const now = clock.getElapsedTime();
    
    radarCtx.clearRect(0, 0, width, height);
    
    // Background/Rings
    radarCtx.strokeStyle = 'rgba(136, 192, 208, 0.3)'; // Nord8 transparent
    radarCtx.lineWidth = 2;
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, width * 0.45, 0, Math.PI * 2);
    radarCtx.stroke();
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, width * 0.25, 0, Math.PI * 2);
    radarCtx.stroke();
    
    // Player (Center)
    radarCtx.fillStyle = '#88C0D0'; // Nord8
    radarCtx.beginPath();
    radarCtx.moveTo(cx, cy - 8);
    radarCtx.lineTo(cx - 6, cy + 6);
    radarCtx.lineTo(cx + 6, cy + 6);
    radarCtx.fill();

    // Player Firing Indicator
    if (now - lastFireTime < 0.2) {
        radarCtx.strokeStyle = '#EBCB8B'; // Nord13 (Yellow)
        radarCtx.lineWidth = 3;
        radarCtx.beginPath();
        radarCtx.arc(cx, cy, 12, 0, Math.PI * 2);
        radarCtx.stroke();
    }

    // Enemies
    const invQuat = tank.mesh.quaternion.clone().invert();
    
    enemies.forEach(enemy => {
        const relPos = enemy.mesh.position.clone().sub(tank.mesh.position);
        relPos.applyQuaternion(invQuat);
        
        // relPos.z is forward (negative) / backward (positive)
        // relPos.x is right (positive) / left (negative)
        
        let px = cx + relPos.x * scale;
        let py = cy + relPos.z * scale;
        
        // Clamp to radar bounds (Outer Ring)
        const dx = px - cx;
        const dy = py - cy;
        const distFromCenter = Math.sqrt(dx*dx + dy*dy);
        const maxRadius = width * 0.45; 

        if (distFromCenter > maxRadius) {
            const angle = Math.atan2(dy, dx);
            px = cx + Math.cos(angle) * maxRadius;
            py = cy + Math.sin(angle) * maxRadius;
        }
        
        radarCtx.fillStyle = '#BF616A'; // Nord11
        radarCtx.beginPath();
        radarCtx.arc(px, py, 5, 0, Math.PI * 2);
        radarCtx.fill();

        // Enemy Firing Indicator
        if (now - enemy.lastFireTime < 0.2) {
            radarCtx.strokeStyle = '#EBCB8B'; // Nord13 (Yellow)
            radarCtx.lineWidth = 2;
            radarCtx.beginPath();
            radarCtx.arc(px, py, 8, 0, Math.PI * 2);
            radarCtx.stroke();
        }
    });

    // Projectiles
    projectiles.forEach(p => {
        const relPos = p.position.clone().sub(tank.mesh.position);
        relPos.applyQuaternion(invQuat);
        
        const dist = relPos.length();
        
        if (dist < RADAR_RANGE) {
            const px = cx + relPos.x * scale;
            const py = cy + relPos.z * scale;
            
            if (p.userData.owner === 'player') {
                radarCtx.fillStyle = '#88C0D0'; // Nord8 (Blue - Friendly)
            } else {
                radarCtx.fillStyle = '#EBCB8B'; // Nord13 (Yellow - Warning)
            }
            
            radarCtx.beginPath();
            radarCtx.arc(px, py, 2, 0, Math.PI * 2);
            radarCtx.fill();
        }
    });
}

// --- UI: Kill Count ---
const killCountContainer = document.createElement('div');
killCountContainer.style.position = 'absolute';
killCountContainer.style.top = '20px';
killCountContainer.style.right = '20px';
killCountContainer.style.width = '300px';
killCountContainer.style.display = 'flex';
killCountContainer.style.flexWrap = 'wrap';
killCountContainer.style.justifyContent = 'flex-end';
killCountContainer.style.gap = '4px';
killCountContainer.style.pointerEvents = 'none';
document.body.appendChild(killCountContainer);

const tankIconSVG = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="6" width="20" height="14" rx="2" fill="#4C566A"/>
    <rect x="5" y="4" width="14" height="14" rx="2" fill="#BF616A"/>
    <rect x="8" y="8" width="8" height="8" rx="2" fill="#2E3440"/>
    <rect x="11" y="2" width="2" height="10" fill="#2E3440"/>
</svg>
`;

function updateKillCountDisplay() {
    const currentCount = killCountContainer.children.length;
    if (killCount === 0) {
        killCountContainer.innerHTML = '';
    } else if (killCount > currentCount) {
        for (let i = 0; i < killCount - currentCount; i++) {
            const div = document.createElement('div');
            div.innerHTML = tankIconSVG;
            killCountContainer.appendChild(div);
        }
    }
}

// --- UI: Vignette ---
const vignette = document.createElement('div');
vignette.style.position = 'absolute';
vignette.style.top = '0';
vignette.style.left = '0';
vignette.style.width = '100%';
vignette.style.height = '100%';
vignette.style.pointerEvents = 'none';
vignette.style.boxShadow = 'inset 0 0 0 0 rgba(191, 97, 106, 0.0)';
vignette.style.transition = 'box-shadow 0.5s';
document.body.appendChild(vignette);

const flashOverlay = document.createElement('div');
flashOverlay.style.position = 'absolute';
flashOverlay.style.top = '0';
flashOverlay.style.left = '0';
flashOverlay.style.width = '100%';
flashOverlay.style.height = '100%';
flashOverlay.style.pointerEvents = 'none';
flashOverlay.style.opacity = '0';
flashOverlay.style.zIndex = '5';
document.body.appendChild(flashOverlay);

const healthFlashOverlay = document.createElement('div');
healthFlashOverlay.style.position = 'absolute';
healthFlashOverlay.style.top = '0';
healthFlashOverlay.style.left = '0';
healthFlashOverlay.style.width = '100%';
healthFlashOverlay.style.height = '100%';
healthFlashOverlay.style.pointerEvents = 'none';
healthFlashOverlay.style.opacity = '0';
healthFlashOverlay.style.zIndex = '6';
document.body.appendChild(healthFlashOverlay);

const style = document.createElement('style');
style.innerHTML = `
@keyframes healthBlink {
  0% { opacity: 0.5; }
  25% { opacity: 0; }
  50% { opacity: 0.5; }
  100% { opacity: 0; }
}
`;
document.head.appendChild(style);

function triggerHealthFlash(isDamage) {
    healthFlashOverlay.style.backgroundColor = isDamage ? '#BF616A' : '#A3BE8C';
    healthFlashOverlay.style.animation = 'none';
    healthFlashOverlay.offsetHeight; /* trigger reflow */
    healthFlashOverlay.style.animation = 'healthBlink 0.5s ease-out';
}

let flashTime = 0;

function updateHealthUI() {
    if (tank.health > 3) {
        vignette.style.boxShadow = 'inset 0 0 0 0 rgba(191, 97, 106, 0.0)';
    } else if (tank.health > 1) {
        vignette.style.boxShadow = 'inset 0 0 50px rgba(191, 97, 106, 0.2)';
    } else {
        vignette.style.boxShadow = 'inset 0 0 150px rgba(191, 97, 106, 0.6)';
    }

    // Update 3D Lights
    if (tank.healthLights) {
        tank.healthLights.forEach((light, i) => {
            if (i < tank.health) {
                if (tank.health > 3) light.material.color.setHex(0xA3BE8C); // Green
                else if (tank.health > 1) light.material.color.setHex(0xEBCB8B); // Yellow
                else light.material.color.setHex(0xBF616A); // Red
            } else {
                light.material.color.setHex(0x2E3440); // Off (Dark Grey)
            }
        });
    }
}

// --- UI: Pause Overlay ---
const pauseOverlay = document.createElement('div');
pauseOverlay.style.position = 'absolute';
pauseOverlay.style.top = '0';
pauseOverlay.style.left = '0';
pauseOverlay.style.width = '100%';
pauseOverlay.style.height = '100%';
pauseOverlay.style.backgroundColor = 'transparent';
pauseOverlay.style.display = 'none';
pauseOverlay.style.justifyContent = 'center';
pauseOverlay.style.alignItems = 'center';
pauseOverlay.style.zIndex = '1000';
pauseOverlay.style.pointerEvents = 'none'; // Let clicks pass through if needed, though usually pause blocks input

document.body.appendChild(pauseOverlay);

let savedCameraState = null;

function pauseAnimate() {
    if (!isPaused) return;
    requestAnimationFrame(pauseAnimate);

    const tankPos = tank.mesh.position;
    const angle = Date.now() * 0.0002;
    const radius = 100;
    
    // Target position (Top down rotating)
    const targetPos = new THREE.Vector3(
        tankPos.x + Math.cos(angle) * radius,
        150,
        tankPos.z + Math.sin(angle) * radius
    );
    
    // Smoothly move there from current position
    camera.position.lerp(targetPos, 0.05);
    camera.lookAt(tankPos);

    renderer.render(scene, camera);
}

function setPaused(state) {
    if (isGameOver) return;
    if (state === isPaused) return;
    
    isPaused = state;
    pauseOverlay.style.display = isPaused ? 'flex' : 'none';
    
    // Toggle UI visibility
    const uiDisplay = isPaused ? 'none' : 'block';
    const killDisplay = isPaused ? 'none' : 'flex';
    radarCanvas.style.display = uiDisplay;
    killCountContainer.style.display = killDisplay;

    if (isPaused) {
        // Save state
        savedCameraState = {
            position: camera.position.clone(),
            quaternion: camera.quaternion.clone()
        };
        pauseAnimate();
    } else {
        // Restore state
        if (savedCameraState) {
            camera.position.copy(savedCameraState.position);
            camera.quaternion.copy(savedCameraState.quaternion);
        }
    }
}

// --- Sky Dome ---
const vertexShader = `
varying vec3 vPosition;
void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const fragmentShader = `
uniform vec3 topColor;
uniform vec3 bottomColor;
uniform float offset;
uniform float exponent;
varying vec3 vPosition;
void main() {
    float h = normalize( vPosition + vec3(0, offset, 0) ).y;
    gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max( h , 0.0), exponent ), 0.0 ) ), 1.0 );
}`;

const skyGeo = new THREE.SphereGeometry( 4000, 32, 15 );
const skyMat = new THREE.ShaderMaterial({
    uniforms: {
        topColor: { value: new THREE.Color( SKY_COLOR ) },
        bottomColor: { value: new THREE.Color( HORIZON_COLOR ) },
        offset: { value: 10 },
        exponent: { value: 0.6 }
    },
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    side: THREE.BackSide
});
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);

// --- Lights ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(50, 100, 50);
dirLight.castShadow = true;
dirLight.shadow.camera.left = -100;
dirLight.shadow.camera.right = 100;
dirLight.shadow.camera.top = 100;
dirLight.shadow.camera.bottom = -100;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);
scene.add(dirLight.target);

// --- Target Indicator ---
const targetIndicator = new THREE.Group();
const ringGeo = new THREE.RingGeometry(3, 3.5, 32);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xBF616A, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }); // Nord11
const ring = new THREE.Mesh(ringGeo, ringMat);
ring.rotation.x = -Math.PI / 2;
targetIndicator.add(ring);

const arrowGeo = new THREE.ConeGeometry(1, 2, 4);
const arrowMat = new THREE.MeshBasicMaterial({ color: 0xBF616A });
const arrow = new THREE.Mesh(arrowGeo, arrowMat);
arrow.position.y = 4;
arrow.rotation.x = Math.PI; // Point down
targetIndicator.add(arrow);

targetIndicator.visible = false;
scene.add(targetIndicator);

const targetRaycaster = new THREE.Raycaster();

// --- Voxel World Generation ---
const voxelGeometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
const grassMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff }); // White to allow instance colors

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const chunks = new Map(); // Key: "cx,cz", Value: { mesh, keys[] }
const voxelMap = new Map(); // Key: "gx,gy,gz", Value: { mesh, index }
const instanceLookup = new Map(); // Key: mesh.uuid, Value: Map(instanceId -> voxelKey)
const heightMap = {}; // Key: "gx,gz", Value: height

function registerInstance(mesh, index, key) {
    if (!instanceLookup.has(mesh.uuid)) {
        instanceLookup.set(mesh.uuid, new Map());
    }
    instanceLookup.get(mesh.uuid).set(index, key);
}

function unregisterInstance(mesh, index) {
    if (instanceLookup.has(mesh.uuid)) {
        instanceLookup.get(mesh.uuid).delete(index);
    }
}

function getChunkKey(cx, cz) { return `${cx},${cz}`; }
function getVoxelKey(gx, gy, gz) { return `${gx},${gy},${gz}`; }

const COLORS = [
    new THREE.Color(0xA3BE8C), // Nord14 (Green)
    new THREE.Color(0xB48EAD), // Nord15 (Purple)
    new THREE.Color(0x4C566A), // Nord3 (Dark Grey)
    new THREE.Color(0xE5E9F0)  // Nord5 (Snow)
];
const BLUE_COLOR = new THREE.Color(0x5E81AC); // Nord10
const CLOUD_COLOR = new THREE.Color(0xD8DEE9); // Nord4

// --- Car Block Geometry ---
const carShape = new THREE.Shape();
carShape.moveTo(0, 0);
carShape.lineTo(6, 0); // Bottom
carShape.lineTo(6, 1.0); // Front Bumper
carShape.lineTo(4.5, 1.1); // Hood start
carShape.lineTo(3.5, 2.1); // Windshield top
carShape.lineTo(1.5, 2.1); // Roof end
carShape.lineTo(0.5, 1.1); // Rear window bottom
carShape.lineTo(0, 1.1); // Trunk end
carShape.lineTo(0, 0); // Rear Bumper

const carGeometry = new THREE.ExtrudeGeometry(carShape, {
    depth: 3.2,
    bevelEnabled: false
});
carGeometry.center();

const carMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff }); // Allow instance color

// --- Helper: Merge Geometries ---
function mergeBufferGeometries(geometries) {
    const attributes = {};
    for (const name in geometries[0].attributes) {
        const arrays = geometries.map(g => g.attributes[name].array);
        const length = arrays.reduce((a, b) => a + b.length, 0);
        const result = new geometries[0].attributes[name].array.constructor(length);
        let offset = 0;
        for (const arr of arrays) {
            result.set(arr, offset);
            offset += arr.length;
        }
        attributes[name] = new THREE.BufferAttribute(result, geometries[0].attributes[name].itemSize);
    }
    const geometry = new THREE.BufferGeometry();
    for (const name in attributes) geometry.setAttribute(name, attributes[name]);
    
    if (geometries[0].index) {
            const indexArrays = geometries.map(g => g.index.array);
            const vertexCounts = geometries.map(g => g.attributes.position.count);
            const totalIndexCount = indexArrays.reduce((a, b) => a + b.length, 0);
            const resultIndex = new (totalIndexCount > 65535 ? Uint32Array : Uint16Array)(totalIndexCount);
            let indexOffset = 0;
            let vertexOffset = 0;
            for (let i=0; i<geometries.length; i++) {
                const arr = indexArrays[i];
                for (let j=0; j<arr.length; j++) {
                    resultIndex[indexOffset + j] = arr[j] + vertexOffset;
                }
                indexOffset += arr.length;
                vertexOffset += vertexCounts[i];
            }
            geometry.setIndex(new THREE.BufferAttribute(resultIndex, 1));
    }
    return geometry;
}

// --- Car Details ---
// Wheels
const wheelBase = new THREE.CylinderGeometry(0.6, 0.6, 0.5, 16);
wheelBase.rotateX(Math.PI / 2);
// Car center is roughly x=3, y=1.05 relative to original shape
// Relative positions:
const w1 = wheelBase.clone().translate(1.8, -0.8, 1.6); // Front Left
const w2 = wheelBase.clone().translate(1.8, -0.8, -1.6); // Front Right
const w3 = wheelBase.clone().translate(-1.8, -0.8, 1.6); // Rear Left
const w4 = wheelBase.clone().translate(-1.8, -0.8, -1.6); // Rear Right
const carWheelGeometry = mergeBufferGeometries([w1, w2, w3, w4]);
const carWheelMaterial = new THREE.MeshStandardMaterial({ color: 0x2E3440 }); // Nord0 (Dark Gray)

// Windows
const glassMat = new THREE.MeshStandardMaterial({ color: 0x88C0D0, roughness: 0.5, metalness: 0.0 }); // Nord8
// Windshield slope is roughly 45 degrees at x=4.0, y=1.6 (relative 1.0, 0.55)
const windshield = new THREE.BoxGeometry(0.1, 1.6, 3.0);
windshield.rotateZ(Math.PI / 4);
windshield.translate(1.0, 0.55, 0);

// Rear window slope is roughly 45 degrees at x=1.0, y=1.6 (relative -2.0, 0.55)
const rearWindow = new THREE.BoxGeometry(0.1, 1.6, 3.0);
rearWindow.rotateZ(-Math.PI / 4);
rearWindow.translate(-2.0, 0.55, 0);

const carGlassGeometry = mergeBufferGeometries([windshield, rearWindow]);

// --- Utilities ---
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// --- Enemy Tanks ---
const enemies = [];
const civilians = [];

function createEnemyTank(pos) {
    const tankGroup = new THREE.Group();
    tankGroup.position.copy(pos);

    const innerGroup = new THREE.Group();
    tankGroup.add(innerGroup);

    // Body
    const bodyGeo = new THREE.BoxGeometry(4, 2, 6);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4C566A }); // Nord3 (Dark Grey)
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.5;
    body.castShadow = true;
    body.receiveShadow = true;
    innerGroup.add(body);

    // Turret
    const turretGeo = new THREE.BoxGeometry(3, 1.5, 3);
    const turretMat = new THREE.MeshStandardMaterial({ color: 0xBF616A }); // Nord11 (Red)
    const turret = new THREE.Mesh(turretGeo, turretMat);
    turret.position.y = 3.25;
    turret.castShadow = true;
    turret.receiveShadow = true;
    innerGroup.add(turret);

    // Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.3, 0.3, 5, 8);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0xBF616A }); // Nord11 (Red)
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, -2.5);
    turret.add(barrel);

    // Tracks
    const leftTrackTexture = createTrackTexture();
    const rightTrackTexture = createTrackTexture();
    const trackGeo = new THREE.BoxGeometry(1, 1.5, 6.5);
    
    const leftTrackMat = new THREE.MeshStandardMaterial({ map: leftTrackTexture });
    const leftTrack = new THREE.Mesh(trackGeo, leftTrackMat);
    leftTrack.position.set(-2.2, 0.75, 0);
    leftTrack.castShadow = true;
    innerGroup.add(leftTrack);

    const rightTrackMat = new THREE.MeshStandardMaterial({ map: rightTrackTexture });
    const rightTrack = new THREE.Mesh(trackGeo, rightTrackMat);
    rightTrack.position.set(2.2, 0.75, 0);
    rightTrack.castShadow = true;
    innerGroup.add(rightTrack);

    // Mufflers
    const mufflerGeo = new THREE.CylinderGeometry(0.25, 0.25, 1.2, 8);
    const mufflerMat = new THREE.MeshStandardMaterial({ color: 0x2E3440 }); // Nord0
    
    const leftMuffler = new THREE.Mesh(mufflerGeo, mufflerMat);
    leftMuffler.position.set(-1.4, 3.1, 2.2);
    leftMuffler.castShadow = true;
    innerGroup.add(leftMuffler);

    const rightMuffler = new THREE.Mesh(mufflerGeo, mufflerMat);
    rightMuffler.position.set(1.4, 3.1, 2.2);
    rightMuffler.castShadow = true;
    innerGroup.add(rightMuffler);

    scene.add(tankGroup);
    enemies.push({ 
        mesh: tankGroup, 
        innerMesh: innerGroup, 
        leftTrackTexture, 
        rightTrackTexture, 
        lastTrackPos: pos.clone(),
        lastFireTime: -100, // Initialize cooldown
        turretMat: turretMat,
        offset: Math.random() * 4, // Random offset for activity cycle
        hasBlindSpot: Math.random() < 0.9, // 90% chance to have a blind spot
        alertedUntil: 0
    });
}

function createCivilianCar(pos, color) {
    const group = new THREE.Group();
    group.position.copy(pos);
    
    // Body
    const body = new THREE.Mesh(carGeometry, new THREE.MeshStandardMaterial({ color: color }));
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    
    // Wheels
    const wheels = new THREE.Mesh(carWheelGeometry, carWheelMaterial);
    wheels.castShadow = true;
    wheels.receiveShadow = true;
    group.add(wheels);
    
    // Glass
    const glass = new THREE.Mesh(carGlassGeometry, glassMat);
    glass.castShadow = true;
    glass.receiveShadow = true;
    group.add(glass);
    
    scene.add(group);
    civilians.push({ 
        mesh: group, 
        speed: ENEMY_SPEED * 0.75, // Slower than enemies but moving
        color: color
    });
}

// --- Track Marks ---
const trackMarks = [];
const trackMarkGeo = new THREE.PlaneGeometry(1, 1);
trackMarkGeo.rotateX(-Math.PI / 2);

function spawnTrackMarks(unit) {
    if (!unit.lastTrackPos) unit.lastTrackPos = unit.mesh.position.clone();

    if (unit.mesh.position.distanceTo(unit.lastTrackPos) > 1.5) {
        const quat = unit.mesh.quaternion;
        
        // Left Track
        const leftPos = new THREE.Vector3(-2.2, 0, 0).applyQuaternion(quat).add(unit.mesh.position);
        const leftH = getTerrainHeight(leftPos.x, leftPos.z);
        if (leftH > -50) {
            leftPos.y = leftH + 0.05;
            createTrackMark(leftPos, quat);
        }

        // Right Track
        const rightPos = new THREE.Vector3(2.2, 0, 0).applyQuaternion(quat).add(unit.mesh.position);
        const rightH = getTerrainHeight(rightPos.x, rightPos.z);
        if (rightH > -50) {
            rightPos.y = rightH + 0.05;
            createTrackMark(rightPos, quat);
        }

        unit.lastTrackPos.copy(unit.mesh.position);
    }
}

function createTrackMark(pos, quat) {
    const mat = new THREE.MeshBasicMaterial({ 
        color: 0x2E3440, // Nord0
        transparent: true, 
        opacity: 0.3,
    });
    const mesh = new THREE.Mesh(trackMarkGeo, mat);
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    
    scene.add(mesh);
    trackMarks.push({ mesh, life: 10.0 }); // 10 seconds life
}

function updateTrackMarks(delta) {
    for (let i = trackMarks.length - 1; i >= 0; i--) {
        const mark = trackMarks[i];
        mark.life -= delta;
        
        if (mark.life <= 0) {
            scene.remove(mark.mesh);
            mark.mesh.material.dispose();
            trackMarks.splice(i, 1);
        } else {
            mark.mesh.material.opacity = (mark.life / 10.0) * 0.3;
        }
    }
}

function generateChunk(cx, cz) {
    const dummy = new THREE.Object3D();
    const maxInstances = CHUNK_SIZE * CHUNK_SIZE * 5; 
    
    const mesh = new THREE.InstancedMesh(voxelGeometry, grassMaterial, maxInstances);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const carMesh = new THREE.InstancedMesh(carGeometry, carMaterial, maxInstances);
    carMesh.castShadow = true;
    carMesh.receiveShadow = true;

    const wheelMesh = new THREE.InstancedMesh(carWheelGeometry, carWheelMaterial, maxInstances);
    wheelMesh.castShadow = true;
    wheelMesh.receiveShadow = true;

    const glassMesh = new THREE.InstancedMesh(carGlassGeometry, glassMat, maxInstances);
    glassMesh.castShadow = true;
    glassMesh.receiveShadow = true;
    
    // Seeded RNG for consistent terrain
    const seed = (cx * 2654435761) ^ (cz * 2246822507);
    const rng = mulberry32(seed);

    let index = 0;
    let carIndex = 0;
    const chunkKeys = [];
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;
    
    // Town Logic:
    // Global Road Grid: Every 8th chunk is a "Highway" (More sparse)
    const isRoadX = (Math.abs(cx) % 8 === 0);
    const isRoadZ = (Math.abs(cz) % 8 === 0);
    const isIntersection = isRoadX && isRoadZ;
    
    // Towns appear along roads, especially at intersections
    // Intersection: 100% Town
    // Road: 40% Town
    // Wilderness: 1% Town (Isolated)
    let isTown = false;
    if (isIntersection) isTown = true;
    else if (isRoadX || isRoadZ) isTown = rng() < 0.4;
    else isTown = rng() < 0.01;

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const gx = startX + x;
            const gz = startZ + z;
            
            // Determine if this specific voxel is part of the road network
            // Roads are 4 voxels wide (x/z = 3,4,5,6)
            let isStreetVoxel = false;
            
            if (isRoadX && x >= 3 && x <= 6) isStreetVoxel = true;
            if (isRoadZ && z >= 3 && z <= 6) isStreetVoxel = true;
            
            // Base ground
            dummy.position.set(gx * VOXEL_SIZE, -VOXEL_SIZE / 2, gz * VOXEL_SIZE);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            
            if (isStreetVoxel) {
                // Paved Road (Dark Grey)
                mesh.setColorAt(index, COLORS[2]);
            } else if (isTown) {
                // Town Base: Pavement (Dark Grey)
                mesh.setColorAt(index, COLORS[2]);
            } else {
                // Nature Base: Randomize base color (mostly green, some teal/dirt)
                const rand = rng();
                if (rand > 0.95) mesh.setColorAt(index, COLORS[2]); // Dirt
                else if (rand > 0.8) mesh.setColorAt(index, COLORS[1]); // Teal
                else mesh.setColorAt(index, COLORS[0]); // Green
            }
            
            const baseKey = getVoxelKey(gx, 0, gz);
            voxelMap.set(baseKey, { mesh, index });
            registerInstance(mesh, index, baseKey);
            chunkKeys.push(baseKey);
            index++;
            
            let height = 0; // Top of base block

            if (isStreetVoxel) {
                // Street - Flat, no buildings
                // Chance for car
                if (rng() < 0.05) {
                     const cColor = new THREE.Color(0xE5E9F0); // White car
                     const carPos = new THREE.Vector3(gx * VOXEL_SIZE, 1.4, gz * VOXEL_SIZE);
                     createCivilianCar(carPos, cColor);
                     
                     // Align car with street
                     // If intersection, random. Else align with road.
                     if (isRoadX && isRoadZ) {
                         const inVert = (x >= 3 && x <= 6);
                         const inHoriz = (z >= 3 && z <= 6);
                         
                         if (inVert && inHoriz) {
                             // Center: Random
                             civilians[civilians.length-1].mesh.rotation.y = (Math.floor(rng() * 4) * Math.PI) / 2;
                         } else if (inVert) {
                             // Vertical arm (Road along Z) -> Face Z (PI/2 or -PI/2)
                             civilians[civilians.length-1].mesh.rotation.y = (rng() > 0.5) ? Math.PI / 2 : -Math.PI / 2;
                         } else {
                             // Horizontal arm (Road along X) -> Face X (0 or PI)
                             civilians[civilians.length-1].mesh.rotation.y = (rng() > 0.5) ? 0 : Math.PI;
                         }
                     } else if (isRoadX) {
                         // Road runs along Z axis (North/South)
                         // Car should face Z (PI/2 or -PI/2)
                         civilians[civilians.length-1].mesh.rotation.y = (rng() > 0.5) ? Math.PI / 2 : -Math.PI / 2;
                     } else {
                         // Road runs along X axis (East/West)
                         // Car should face X (0 or PI)
                         civilians[civilians.length-1].mesh.rotation.y = (rng() > 0.5) ? 0 : Math.PI;
                     }
                }
            } else if (isTown) {
                // Town Generation (Non-Street areas)
                
                // 30% chance for an empty lot (park/parking)
                if (rng() > 0.3) {
                    // Building Lot
                    // Random height 1-4
                    const buildingHeight = Math.floor(rng() * 4) + 1;
                    const bColor = [
                        new THREE.Color(0xBF616A), // Red
                        new THREE.Color(0xD08770), // Orange
                        new THREE.Color(0xEBCB8B), // Yellow
                        new THREE.Color(0x5E81AC), // Blue
                        new THREE.Color(0xB48EAD)  // Purple
                    ][Math.floor(rng() * 5)];

                    for (let h = 1; h <= buildingHeight; h++) {
                        dummy.position.set(gx * VOXEL_SIZE, (h * VOXEL_SIZE) - (VOXEL_SIZE/2), gz * VOXEL_SIZE);
                        dummy.updateMatrix();
                        mesh.setMatrixAt(index, dummy.matrix);
                        mesh.setColorAt(index, bColor);
                        
                        const bKey = getVoxelKey(gx, h, gz);
                        voxelMap.set(bKey, { mesh, index });
                        registerInstance(mesh, index, bKey);
                        chunkKeys.push(bKey);
                        index++;
                    }
                    height = buildingHeight * VOXEL_SIZE;
                }
            } else {
                // Random hills (Nature)
                // Keep center 3x3 flat for spawn
                if ((Math.abs(gx) > 1 || Math.abs(gz) > 1)) {
                    const randHeight = rng();
                    
                    // Level 1 (Chance: ~2%)
                    if (randHeight > 0.98) {
                        const isTall = randHeight > 0.99;

                        dummy.position.set(gx * VOXEL_SIZE, VOXEL_SIZE / 2, gz * VOXEL_SIZE);
                        
                        if (isTall) {
                            mesh.setColorAt(index, BLUE_COLOR);
                        } else {
                            // Hills are snowy or teal
                            if (rng() > 0.5) {
                                mesh.setColorAt(index, COLORS[3]); // Snow (Nord5)
                            } else {
                                mesh.setColorAt(index, COLORS[1]); // Teal
                            }
                        }
                        
                        dummy.rotation.set(0, 0, 0);
                        dummy.updateMatrix();
                        mesh.setMatrixAt(index, dummy.matrix);
                        
                        const hillKey = getVoxelKey(gx, 1, gz);
                        voxelMap.set(hillKey, { mesh, index });
                        registerInstance(mesh, index, hillKey);
                        chunkKeys.push(hillKey);
                        index++;
                        
                        height = VOXEL_SIZE; // Top of hill block

                        // Level 2 (Chance: ~3% of total)
                        if (isTall) {
                            dummy.position.set(gx * VOXEL_SIZE, VOXEL_SIZE * 1.5, gz * VOXEL_SIZE);
                            dummy.rotation.set(0, 0, 0);
                            dummy.updateMatrix();
                            mesh.setMatrixAt(index, dummy.matrix);
                            
                            mesh.setColorAt(index, BLUE_COLOR);
                            
                            const l2Key = getVoxelKey(gx, 2, gz);
                            voxelMap.set(l2Key, { mesh, index });
                            registerInstance(mesh, index, l2Key);
                            chunkKeys.push(l2Key);
                            index++;
                            height = VOXEL_SIZE * 2;

                            // Level 3 (Chance: 10% of Level 2)
                            if (rng() > 0.9) {
                                dummy.position.set(gx * VOXEL_SIZE, VOXEL_SIZE * 2.5, gz * VOXEL_SIZE);
                                dummy.updateMatrix();
                                mesh.setMatrixAt(index, dummy.matrix);
                                
                                mesh.setColorAt(index, BLUE_COLOR);
                                
                                const l3Key = getVoxelKey(gx, 3, gz);
                                voxelMap.set(l3Key, { mesh, index });
                                registerInstance(mesh, index, l3Key);
                                chunkKeys.push(l3Key);
                                index++;
                                height = VOXEL_SIZE * 3;
                            }
                        }
                    }
                }
            }
            
            heightMap[`${gx},${gz}`] = height;
        }
    }
    
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    worldGroup.add(mesh);

    carMesh.count = carIndex;
    carMesh.instanceMatrix.needsUpdate = true;
    if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
    worldGroup.add(carMesh);

    wheelMesh.count = carIndex;
    wheelMesh.instanceMatrix.needsUpdate = true;
    worldGroup.add(wheelMesh);

    glassMesh.count = carIndex;
    glassMesh.instanceMatrix.needsUpdate = true;
    worldGroup.add(glassMesh);
    
    // Spawn Enemy (20% chance per chunk, but not at 0,0)
    if ((cx !== 0 || cz !== 0) && rng() > 0.8) {
        const rx = Math.floor(rng() * CHUNK_SIZE);
        const rz = Math.floor(rng() * CHUNK_SIZE);
        const gx = startX + rx;
        const gz = startZ + rz;
        
        // Ensure we spawn on flat ground (height 0) and have clearance
        // Check 3x3 area (tank is large and rotates)
        let clear = true;
        for(let dx = -1; dx <= 1; dx++) {
            for(let dz = -1; dz <= 1; dz++) {
                const key = `${gx+dx},${gz+dz}`;
                const h = heightMap[key];
                // Must be explicitly 0 (ground level). Undefined means unknown/not generated -> unsafe.
                if (h !== 0) {
                    clear = false;
                    break;
                }
            }
            if(!clear) break;
        }

        if (clear) {
            const pos = new THREE.Vector3(gx * VOXEL_SIZE, 0, gz * VOXEL_SIZE);
            createEnemyTank(pos);
        }
    }

    return { meshes: [mesh, carMesh, wheelMesh, glassMesh], keys: chunkKeys };
}

let lastChunkX = null;
let lastChunkZ = null;

function updateChunks() {
    const tankPos = tank.mesh.position;
    const cx = Math.floor(tankPos.x / (VOXEL_SIZE * CHUNK_SIZE));
    const cz = Math.floor(tankPos.z / (VOXEL_SIZE * CHUNK_SIZE));
    
    if (cx === lastChunkX && cz === lastChunkZ) return;
    lastChunkX = cx;
    lastChunkZ = cz;

    const activeKeys = new Set();
    
    for (let x = -DRAW_DISTANCE; x <= DRAW_DISTANCE; x++) {
        for (let z = -DRAW_DISTANCE; z <= DRAW_DISTANCE; z++) {
            const key = getChunkKey(cx + x, cz + z);
            activeKeys.add(key);
            
            if (!chunks.has(key)) {
                chunks.set(key, generateChunk(cx + x, cz + z));
            }
        }
    }
    
    // Cleanup far chunks
    for (const [key, chunk] of chunks) {
        if (!activeKeys.has(key)) {
            chunk.meshes.forEach(m => {
                worldGroup.remove(m);
                m.dispose();
            });
            chunk.keys.forEach(k => {
                const data = voxelMap.get(k);
                if (data) {
                    unregisterInstance(data.mesh, data.index);
                    if (data.parts) {
                        data.parts.forEach(p => unregisterInstance(p.mesh, p.index));
                    }
                }
                voxelMap.delete(k);
            });
            chunks.delete(key);
        }
    }
}

function updateHeightMap(gx, gz) {
    // Check from top down
    if (voxelMap.has(getVoxelKey(gx, 3, gz))) {
        heightMap[`${gx},${gz}`] = VOXEL_SIZE * 3;
    } else if (voxelMap.has(getVoxelKey(gx, 2, gz))) {
        heightMap[`${gx},${gz}`] = VOXEL_SIZE * 2;
    } else if (voxelMap.has(getVoxelKey(gx, 1, gz))) {
        heightMap[`${gx},${gz}`] = VOXEL_SIZE;
    } else if (voxelMap.has(getVoxelKey(gx, 0, gz))) {
        heightMap[`${gx},${gz}`] = 0;
    } else {
        heightMap[`${gx},${gz}`] = -100; // Hole
    }
}

function getTerrainHeight(x, z) {
    const voxelX = Math.floor(x / VOXEL_SIZE + 0.5);
    const voxelZ = Math.floor(z / VOXEL_SIZE + 0.5);
    const key = `${voxelX},${voxelZ}`;
    return heightMap[key] !== undefined ? heightMap[key] : -100; // Fallback if off map
}

function attemptPush(pos, direction) {
    const halfWidth = 2; 
    const halfLength = 3;
    const points = [
        new THREE.Vector3(halfWidth, 1, halfLength),
        new THREE.Vector3(-halfWidth, 1, halfLength),
        new THREE.Vector3(halfWidth, 1, -halfLength),
        new THREE.Vector3(-halfWidth, 1, -halfLength)
    ];
    
    let pushedAny = false;

    for (const p of points) {
        const worldP = p.clone().applyQuaternion(tank.mesh.quaternion).add(pos);
        const gx = Math.round(worldP.x / VOXEL_SIZE);
        const gy = Math.round((worldP.y + VOXEL_SIZE/2) / VOXEL_SIZE);
        const gz = Math.round(worldP.z / VOXEL_SIZE);
        const key = getVoxelKey(gx, gy, gz);
        
        if (voxelMap.has(key)) {
            const { mesh, index, parts } = voxelMap.get(key);
            const color = new THREE.Color();
            if (mesh.instanceColor) mesh.getColorAt(index, color);
            
            // Check if Snow (Nord5) - Light colored
            // Or if it's a car (check geometry type or just assume cars are pushable)
            
            if (mesh.geometry === carGeometry) {
                // Determine push direction (snap to axis)
                const pushX = Math.abs(direction.x) > Math.abs(direction.z) ? Math.sign(direction.x) : 0;
                const pushZ = Math.abs(direction.z) >= Math.abs(direction.x) ? Math.sign(direction.z) : 0;
                
                // Don't push up/down or nowhere
                if (pushX === 0 && pushZ === 0) continue;

                const nextGx = gx + pushX;
                const nextGz = gz + pushZ;
                const nextKey = getVoxelKey(nextGx, gy, nextGz);
                
                // Check if destination is empty
                if (!voxelMap.has(nextKey)) {
                    // Check if there is ground below the new position (so it doesn't float)
                    const groundKey = getVoxelKey(nextGx, gy - 1, nextGz);
                    if (voxelMap.has(groundKey)) {
                        // Move it
                        const dummy = new THREE.Object3D();
                        const matrix = new THREE.Matrix4();
                        mesh.getMatrixAt(index, matrix);
                        
                        // Calculate new position
                        const newPos = new THREE.Vector3(nextGx * VOXEL_SIZE, (gy * VOXEL_SIZE) - (VOXEL_SIZE/2), nextGz * VOXEL_SIZE);
                        
                        dummy.position.copy(newPos);
                        // Keep rotation
                        const rot = new THREE.Quaternion();
                        const pos = new THREE.Vector3();
                        const scale = new THREE.Vector3();
                        matrix.decompose(pos, rot, scale);
                        dummy.quaternion.copy(rot);
                        dummy.scale.copy(scale);

                        dummy.updateMatrix();
                        mesh.setMatrixAt(index, dummy.matrix);
                        mesh.instanceMatrix.needsUpdate = true;

                        if (parts) {
                            parts.forEach(p => {
                                p.mesh.setMatrixAt(p.index, dummy.matrix);
                                p.mesh.instanceMatrix.needsUpdate = true;
                            });
                        }
                        
                        voxelMap.delete(key);
                        voxelMap.set(nextKey, { mesh, index, parts });
                        
                        // Update Lookup
                        unregisterInstance(mesh, index);
                        registerInstance(mesh, index, nextKey);
                        if (parts) {
                            parts.forEach(p => {
                                unregisterInstance(p.mesh, p.index);
                                registerInstance(p.mesh, p.index, nextKey);
                            });
                        }

                        updateHeightMap(gx, gz);
                        updateHeightMap(nextGx, nextGz);
                        
                        pushedAny = true;
                    }
                }
            }
        }
    }
    return pushedAny;
}

function checkEnvironmentCollision(pos, quat) {
    // Tighter collision box for cars (approx 4.5 x 3.2)
    const points = [
        new THREE.Vector3(2.2, 1, 1.5), new THREE.Vector3(-2.2, 1, 1.5),
        new THREE.Vector3(2.2, 1, -1.5), new THREE.Vector3(-2.2, 1, -1.5),
        new THREE.Vector3(2.2, 1, 0), new THREE.Vector3(-2.2, 1, 0),
        new THREE.Vector3(0, 1, 1.5), new THREE.Vector3(0, 1, -1.5)
    ];
    
    for (const p of points) {
        const worldP = p.clone().applyQuaternion(quat).add(pos);
        const gx = Math.round(worldP.x / VOXEL_SIZE);
        const gy = Math.round((worldP.y + VOXEL_SIZE/2) / VOXEL_SIZE);
        const gz = Math.round(worldP.z / VOXEL_SIZE);
        if (voxelMap.has(getVoxelKey(gx, gy, gz))) return true;
    }
    return false;
}

function checkTankCollision(pos, quat) {
    // Chamfered box for smoother sliding
    // Tank is 4 wide (X), 6 long (Z)
    // Collision: 3.6 wide, 5.0 long
    const y = 1; 
    const points = [
        new THREE.Vector3(0, y, 2.5),   
        new THREE.Vector3(0, y, -2.5),  
        new THREE.Vector3(1.8, y, 0),   
        new THREE.Vector3(-1.8, y, 0),  
        new THREE.Vector3(1.5, y, 2.0),  
        new THREE.Vector3(-1.5, y, 2.0), 
        new THREE.Vector3(1.5, y, -2.0), 
        new THREE.Vector3(-1.5, y, -2.0) 
    ];
    
    for (const p of points) {
        const worldP = p.clone().applyQuaternion(quat).add(pos);
        const gx = Math.round(worldP.x / VOXEL_SIZE);
        const gy = Math.round((worldP.y + VOXEL_SIZE/2) / VOXEL_SIZE);
        const gz = Math.round(worldP.z / VOXEL_SIZE);
        if (voxelMap.has(getVoxelKey(gx, gy, gz))) return true;
    }
    return false;
}

function resolveEntityCollisions() {
    const units = [tank, ...enemies, ...civilians];
    const radius = 2.5; 

    for (let i = 0; i < units.length; i++) {
        for (let j = i + 1; j < units.length; j++) {
            const u1 = units[i];
            const u2 = units[j];
            
            const dist = u1.mesh.position.distanceTo(u2.mesh.position);
            if (dist < radius * 2) {
                const overlap = (radius * 2) - dist;
                const dir = u1.mesh.position.clone().sub(u2.mesh.position).normalize();
                
                // Push u1
                const push1 = dir.clone().multiplyScalar(overlap * 0.5);
                const newPos1 = u1.mesh.position.clone().add(push1);
                if (!checkEnvironmentCollision(newPos1, u1.mesh.quaternion)) {
                    u1.mesh.position.copy(newPos1);
                }
                
                // Push u2
                const push2 = dir.clone().multiplyScalar(-overlap * 0.5);
                const newPos2 = u2.mesh.position.clone().add(push2);
                if (!checkEnvironmentCollision(newPos2, u2.mesh.quaternion)) {
                    u2.mesh.position.copy(newPos2);
                }
            }
        }
    }
}


// --- Tank Construction ---


function createTrackTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Background (Nord0)
    ctx.fillStyle = '#2E3440';
    ctx.fillRect(0, 0, 64, 64);
    
    // Treads (Nord3)
    ctx.fillStyle = '#4C566A';
    for (let i = 0; i < 64; i += 16) {
        ctx.fillRect(0, i, 64, 8);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    return texture;
}

// --- Tank Construction ---
function createTank() {
    const tankGroup = new THREE.Group();
    const innerGroup = new THREE.Group();
    tankGroup.add(innerGroup);

    // Body
    const bodyGeo = new THREE.BoxGeometry(4, 2, 6);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5E81AC }); // Nord10
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.5; // Lift up so wheels can be below (conceptually)
    body.castShadow = true;
    body.receiveShadow = true;
    innerGroup.add(body);

    // Turret Group
    const turret = new THREE.Group();
    turret.position.y = 3.25;
    innerGroup.add(turret);

    // Main Turret Block
    const turretGeo = new THREE.BoxGeometry(3, 1.5, 3);
    const turretMat = new THREE.MeshStandardMaterial({ color: 0x88C0D0 }); // Nord8
    const turretMesh = new THREE.Mesh(turretGeo, turretMat);
    turretMesh.castShadow = true;
    turretMesh.receiveShadow = true;
    turret.add(turretMesh);

    // Detail: Commander's Cupola (Nord13 - Yellow)
    const cupolaGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.6, 8);
    const cupolaMat = new THREE.MeshStandardMaterial({ color: 0xEBCB8B }); // Nord13
    const cupola = new THREE.Mesh(cupolaGeo, cupolaMat);
    cupola.position.set(0.8, 1.0, 0.5);
    cupola.castShadow = true;
    turret.add(cupola);

    // Detail: Rear Bustle (Nord3 - Dark Grey)
    const bustleGeo = new THREE.BoxGeometry(2.5, 1.2, 1.5);
    const bustleMat = new THREE.MeshStandardMaterial({ color: 0x4C566A }); // Nord3
    const bustle = new THREE.Mesh(bustleGeo, bustleMat);
    bustle.position.set(0, 0.2, 2.0);
    bustle.castShadow = true;
    turret.add(bustle);

    // Health Lights on Bustle
    const healthLights = [];
    const lightGeo = new THREE.BoxGeometry(0.4, 0.2, 0.1);
    
    for (let i = 0; i < 5; i++) {
        const lightMat = new THREE.MeshBasicMaterial({ color: 0xA3BE8C }); // Green
        const light = new THREE.Mesh(lightGeo, lightMat);
        // Position on back of bustle
        const x = -1.0 + (i * 0.5);
        light.position.set(x, 0.5, 2.8); 
        turret.add(light);
        healthLights.push(light);
    }

    // Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.3, 0.3, 5, 8);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x88C0D0 }); // Nord8
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, -2.5); // Stick out front
    turret.add(barrel);

    // Detail: Muzzle Brake (Nord3 - Dark Grey)
    const brakeGeo = new THREE.BoxGeometry(0.8, 0.8, 1);
    const brakeMat = new THREE.MeshStandardMaterial({ color: 0x4C566A }); // Nord3
    const brake = new THREE.Mesh(brakeGeo, brakeMat);
    brake.position.set(0, 2.5, 0); // At the tip of the barrel
    barrel.add(brake);

    // Tracks (Visual only)
    const leftTrackTexture = createTrackTexture();
    const rightTrackTexture = createTrackTexture();
    
    const trackGeo = new THREE.BoxGeometry(1, 1.5, 6.5);
    
    const leftTrackMat = new THREE.MeshStandardMaterial({ map: leftTrackTexture });
    const leftTrack = new THREE.Mesh(trackGeo, leftTrackMat);
    leftTrack.position.set(-2.2, 0.75, 0);
    leftTrack.castShadow = true;
    innerGroup.add(leftTrack);

    const rightTrackMat = new THREE.MeshStandardMaterial({ map: rightTrackTexture });
    const rightTrack = new THREE.Mesh(trackGeo, rightTrackMat);
    rightTrack.position.set(2.2, 0.75, 0);
    rightTrack.castShadow = true;
    innerGroup.add(rightTrack);

    // Mufflers
    const mufflerGeo = new THREE.CylinderGeometry(0.25, 0.25, 1.2, 8);
    const mufflerMat = new THREE.MeshStandardMaterial({ color: 0x2E3440 }); // Nord0
    
    const leftMuffler = new THREE.Mesh(mufflerGeo, mufflerMat);
    leftMuffler.position.set(-1.4, 3.1, 2.2);
    leftMuffler.castShadow = true;
    innerGroup.add(leftMuffler);

    const rightMuffler = new THREE.Mesh(mufflerGeo, mufflerMat);
    rightMuffler.position.set(1.4, 3.1, 2.2);
    rightMuffler.castShadow = true;
    innerGroup.add(rightMuffler);

    return { 
        mesh: tankGroup, 
        innerMesh: innerGroup, 
        turret: turret, 
        barrel: barrel, 
        bodyMat: bodyMat,
        healthLights: healthLights,
        leftTrackTexture: leftTrackTexture, 
        rightTrackTexture: rightTrackTexture, 
        currentSpeed: 0,
        health: MAX_HEALTH,
        damageFlashTime: 0
    };
}

const tank = createTank();
scene.add(tank.mesh);
tank.mesh.position.set(25, 0, 25); // Start at center of chunk (0,0), which is a road intersection

let recoilVelocity = new THREE.Vector3();

// --- Projectiles ---
const projectiles = [];
const projectileGeo = new THREE.SphereGeometry(0.5, 8, 8);
const projectileMat = new THREE.MeshStandardMaterial({ color: 0xBF616A }); // Nord11

let lastFireTime = -100; // Allow immediate first shot

function shoot() {
    const now = clock.getElapsedTime();
    if (now - lastFireTime < FIRE_COOLDOWN) return;
    
    lastFireTime = now;
    
    // Change barrel color to Red (Cooldown)
    tank.barrel.material.color.setHex(0xBF616A); // Nord11

    // Barrel Recoil Animation
    tank.barrel.position.z = -1.5;

    const projectile = new THREE.Mesh(projectileGeo, projectileMat);
    
    // Get position of the barrel tip
    // Barrel is at local (0, 0, -2.5) relative to turret, length 5.
    // Tip is at (0, 0, -5) relative to turret.
    const startPos = new THREE.Vector3(0, 0, -5);
    startPos.applyMatrix4(tank.turret.matrixWorld);
    
    projectile.position.copy(startPos);
    
    // Get direction turret is facing
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(tank.turret.getWorldQuaternion(new THREE.Quaternion()));
    
    projectile.userData.velocity = direction.multiplyScalar(PLAYER_PROJECTILE_SPEED);
    projectile.userData.owner = 'player'; // Tag as player projectile
    
    scene.add(projectile);
    projectiles.push(projectile);

    createMuzzleFlash(startPos, direction);

    // Recoil
    const recoilForce = direction.clone().normalize().negate().multiplyScalar(2);
    recoilVelocity.add(recoilForce);
    
    // Pitch Kick (Nose Up)
    tank.innerMesh.rotation.x += 0.1;
}

function takeDamage() {
    if (isGameOver) return;

    tank.health -= 1;
    triggerHealthFlash(true);
    tank.damageFlashTime = 0.1;
    updateHealthUI();
    
    if (tank.health <= 0) {
        gameOver();
    }
}

function restartGame() {
    const overlay = document.getElementById('gameOverOverlay');
    if (overlay) overlay.remove();

    // Show UI
    radarCanvas.style.display = 'block';
    killCountContainer.style.display = 'flex';

    // Reset Tank
    tank.health = MAX_HEALTH;
    tank.mesh.position.set(25, 0, 25); // Start at center of chunk (0,0), which is a road intersection
    tank.mesh.rotation.set(0, 0, 0);
    tank.innerMesh.rotation.set(0, 0, 0);
    tank.currentSpeed = 0;
    tank.bodyMat.color.setHex(0x5E81AC); // Nord10
    tank.damageFlashTime = 0;
    updateHealthUI();

    killCount = 0;
    updateKillCountDisplay();
    gameStartTime = clock.getElapsedTime();

    // Clear Enemies
    enemies.forEach(e => scene.remove(e.mesh));
    enemies.length = 0;

    // Clear Civilians
    civilians.forEach(c => scene.remove(c.mesh));
    civilians.length = 0;

    spawnReinforcements(10);
    lastPeriodicSpawnTime = clock.getElapsedTime();

    // Clear Projectiles
    projectiles.forEach(p => scene.remove(p));
    projectiles.length = 0;

    // Clear Particles
    particles.forEach(p => {
        scene.remove(p);
        p.material.dispose();
    });
    particles.length = 0;
    
    exhaustParticles.forEach(p => {
        scene.remove(p);
        p.material.dispose();
    });
    exhaustParticles.length = 0;

    trackMarks.forEach(t => {
        scene.remove(t.mesh);
        t.mesh.material.dispose();
    });
    trackMarks.length = 0;

    isGameOver = false;
    animate();
}

function gameOver() {
    isGameOver = true;
    
    // Hide UI
    radarCanvas.style.display = 'none';
    killCountContainer.style.display = 'none';
    
    // Move camera to top-down view
    const tankPos = tank.mesh.position;
    const topDownPos = new THREE.Vector3(tankPos.x, 150, tankPos.z + 50); // High up, slightly offset
    
    // Animate camera to position
    const startPos = camera.position.clone();
    const startRot = camera.quaternion.clone();
    
    const dummyCam = new THREE.PerspectiveCamera();
    dummyCam.position.copy(topDownPos);
    dummyCam.lookAt(tankPos);
    const endRot = dummyCam.quaternion;

    let progress = 0;
    function animateGameOverCam() {
        if (!isGameOver) return;
        requestAnimationFrame(animateGameOverCam);
        
        progress += 0.01;
        if (progress <= 1) {
            camera.position.lerpVectors(startPos, topDownPos, progress);
            camera.quaternion.slerp(endRot, progress);
        } else {
            // Rotate slowly around
            const angle = Date.now() * 0.0002;
            const radius = 100;
            camera.position.x = tankPos.x + Math.cos(angle) * radius;
            camera.position.z = tankPos.z + Math.sin(angle) * radius;
            camera.lookAt(tankPos);
        }
        renderer.render(scene, camera);
    }
    animateGameOverCam();

    const overlay = document.createElement('div');
    overlay.id = 'gameOverOverlay';
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'transparent';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.cursor = 'pointer';
    overlay.style.fontFamily = 'sans-serif';
    
    const scoreContainer = document.createElement('div');
    scoreContainer.style.display = 'flex';
    scoreContainer.style.flexDirection = 'column';
    scoreContainer.style.gap = '10px';
    scoreContainer.style.alignItems = 'center';
    scoreContainer.style.maxWidth = '90%';
    overlay.appendChild(scoreContainer);

    let currentRow;
    for (let i = 0; i < killCount; i++) {
        if (i % 10 === 0) {
            currentRow = document.createElement('div');
            currentRow.style.display = 'flex';
            currentRow.style.gap = '10px';
            currentRow.style.justifyContent = 'center';
            currentRow.style.flexWrap = 'nowrap'; // Force single row
            scoreContainer.appendChild(currentRow);
        }
        
        const div = document.createElement('div');
        div.innerHTML = tankIconSVG;
        // Scale up the icon slightly for the game over screen
        const svg = div.querySelector('svg');
        if (svg) {
            svg.setAttribute('width', '48');
            svg.setAttribute('height', '48');
        }
        div.style.flexShrink = '0'; // Prevent icons from squishing
        currentRow.appendChild(div);
    }
    
    overlay.onclick = restartGame;
    
    document.body.appendChild(overlay);
}

function triggerDirectionalFlash(sourcePos) {
    const toSource = sourcePos.clone().sub(tank.mesh.position);
    toSource.applyQuaternion(tank.mesh.quaternion.clone().invert());
    toSource.normalize();
    
    const cx = 50 + toSource.x * 60; 
    const cy = 50 + toSource.z * 60; 
    
    flashOverlay.style.background = `radial-gradient(circle at ${cx}% ${cy}%, rgba(235, 203, 139, 0.4) 0%, transparent 50%)`;
    flashOverlay.style.opacity = '1';
    flashTime = 0.3;
}

function enemyShoot(enemy) {
    const now = clock.getElapsedTime();
    if (now - gameStartTime < 5) return; // 5 second grace period
    if (now - enemy.lastFireTime < ENEMY_FIRE_COOLDOWN) return;
    
    enemy.lastFireTime = now;

    const projectile = new THREE.Mesh(projectileGeo, projectileMat);
    
    // Start position (approximate barrel tip for enemy)
    // Enemy structure: mesh -> innerMesh -> turret -> barrel
    // We can just use the enemy position + offset rotated by quaternion
    const startPos = new THREE.Vector3(0, 3.25, -5.0); // Turret height + barrel tip
    startPos.applyQuaternion(enemy.mesh.quaternion);
    startPos.add(enemy.mesh.position);
    
    projectile.position.copy(startPos);
    
    // Direction
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(enemy.mesh.quaternion);
    
    projectile.userData.velocity = direction.multiplyScalar(PROJECTILE_SPEED);
    projectile.userData.owner = 'enemy'; // Tag as enemy projectile
    
    scene.add(projectile);
    projectiles.push(projectile);

    createMuzzleFlash(startPos, direction, 3); // Less smoke for enemies

    // Screen Flash Indicator (Only if close)
    if (tank.mesh.position.distanceTo(enemy.mesh.position) < 80) {
        triggerDirectionalFlash(enemy.mesh.position);
    }
}

// --- Explosions ---
const particles = [];
const particleGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5); // Debris chunks

function createExplosion(pos, blockColor) {
    // 1. Flash
    const flashGeo = new THREE.BoxGeometry(15, 15, 15);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xEBCB8B, transparent: true, opacity: 0.8 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(pos);
    flash.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    flash.userData = { velocity: new THREE.Vector3(0,0,0), life: 0.2, noGravity: true };
    scene.add(flash);
    particles.push(flash);

    // 2. Debris (Red, Orange, Yellow, and Block Color)
    const colors = [
        new THREE.Color(0xBF616A), // Red
        new THREE.Color(0xD08770), // Orange
        new THREE.Color(0xEBCB8B), // Yellow
        blockColor || new THREE.Color(0x4C566A) // Original or Dark Grey
    ];

    for (let i = 0; i < 20; i++) {
        const pColor = colors[Math.floor(Math.random() * colors.length)];
        const material = new THREE.MeshStandardMaterial({ color: pColor });
        const particle = new THREE.Mesh(particleGeo, material);
        
        particle.position.copy(pos).add(new THREE.Vector3(
            (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 4
        ));
        
        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 30,
            (Math.random() * 30) + 10,
            (Math.random() - 0.5) * 30
        );
        
        particle.userData = { velocity: velocity, life: 1.0 + Math.random() };
        scene.add(particle);
        particles.push(particle);
    }

    // 3. Smoke
    for (let i = 0; i < 10; i++) {
        const smokePos = pos.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 5,
            Math.random() * 5,
            (Math.random() - 0.5) * 5
        ));
        createExhaust(smokePos);
    }
}

function createRicochet(pos, incomingVelocity) {
    const nordRed = new THREE.Color(0xBF616A);
    const nordYellow = new THREE.Color(0xEBCB8B);
    
    const baseDir = incomingVelocity.clone().normalize().negate();

    for (let i = 0; i < 4; i++) {
        const pColor = Math.random() > 0.5 ? nordRed : nordYellow;
        const material = new THREE.MeshStandardMaterial({ color: pColor });
        const particle = new THREE.Mesh(particleGeo, material);
        
        particle.position.copy(pos);
        
        const velocity = baseDir.clone().add(new THREE.Vector3(
            (Math.random() - 0.5),
            (Math.random() - 0.5),
            (Math.random() - 0.5)
        )).normalize().multiplyScalar(15);
        
        particle.userData = { velocity: velocity, life: 0.5 }; 
        scene.add(particle);
        particles.push(particle);
    }
}

function updateParticles(delta) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.userData.life -= delta;
        
        if (p.userData.life <= 0) {
            scene.remove(p);
            particles.splice(i, 1);
            p.material.dispose();
            continue;
        }
        
        // Physics
        if (!p.userData.noGravity) {
            p.userData.velocity.y -= 50 * delta; // Gravity
        }
        p.position.addScaledVector(p.userData.velocity, delta);
        p.rotation.x += p.userData.velocity.z * delta;
        p.rotation.z -= p.userData.velocity.x * delta;
        
        // Scale down
        const scale = p.userData.life;
        p.scale.setScalar(scale);
    }
}

// --- Exhaust ---
const exhaustParticles = [];
const exhaustGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
const exhaustMat = new THREE.MeshBasicMaterial({ color: 0x2E3440, transparent: true, opacity: 0.6 });

function createExhaust(pos) {
    const mesh = new THREE.Mesh(exhaustGeo, exhaustMat.clone());
    mesh.position.copy(pos);
    
    // Random offset
    mesh.position.x += (Math.random() - 0.5) * 0.2;
    mesh.position.z += (Math.random() - 0.5) * 0.2;
    
    mesh.userData = {
        velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 0.5,
            Math.random() * 2 + 1,
            (Math.random() - 0.5) * 0.5
        ),
        life: 1.0 + Math.random() * 0.5
    };
    
    scene.add(mesh);
    exhaustParticles.push(mesh);
}

function updateExhaust(delta) {
    for (let i = exhaustParticles.length - 1; i >= 0; i--) {
        const p = exhaustParticles[i];
        p.userData.life -= delta;
        
        if (p.userData.life <= 0) {
            scene.remove(p);
            p.material.dispose();
            exhaustParticles.splice(i, 1);
            continue;
        }
        
        p.position.addScaledVector(p.userData.velocity, delta);
        
        if (p.userData.drag) {
            p.userData.velocity.multiplyScalar(Math.max(0, 1 - p.userData.drag * delta));
        }

        p.material.opacity = (p.userData.life / 1.5) * 0.6;
    }
}

function createMuzzleFlash(pos, dir) {
    // Flash
    const flashGeo = new THREE.BoxGeometry(12.0, 12.0, 12.0);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xEBCB8B, transparent: true, opacity: 0.9 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(pos);
    flash.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    flash.userData = { velocity: new THREE.Vector3(0,0,0), life: 0.15, noGravity: true };
    scene.add(flash);
    particles.push(flash);
}

// --- Touch Controls ---
let touchTurnInput = 0;
let touchForwardInput = 0;
let isTouchActive = false;

function createTouchControls() {
    // Joystick Container
    const joystickZone = document.createElement('div');
    joystickZone.style.position = 'absolute';
    joystickZone.style.bottom = '40px';
    joystickZone.style.left = '40px';
    joystickZone.style.width = '120px';
    joystickZone.style.height = '120px';
    joystickZone.style.background = 'rgba(255, 255, 255, 0.1)';
    joystickZone.style.borderRadius = '50%';
    joystickZone.style.border = '2px solid rgba(255, 255, 255, 0.3)';
    joystickZone.style.touchAction = 'none'; // Prevent scrolling
    document.body.appendChild(joystickZone);

    // Joystick Knob
    const knob = document.createElement('div');
    knob.style.position = 'absolute';
    knob.style.top = '50%';
    knob.style.left = '50%';
    knob.style.width = '50px';
    knob.style.height = '50px';
    knob.style.background = 'rgba(255, 255, 255, 0.5)';
    knob.style.borderRadius = '50%';
    knob.style.transform = 'translate(-50%, -50%)';
    knob.style.pointerEvents = 'none';
    joystickZone.appendChild(knob);

    // Fire Button
    const fireBtn = document.createElement('div');
    fireBtn.style.position = 'absolute';
    fireBtn.style.bottom = '60px';
    fireBtn.style.right = '60px';
    fireBtn.style.width = '80px';
    fireBtn.style.height = '80px';
    fireBtn.style.background = 'rgba(191, 97, 106, 0.6)'; // Nord11
    fireBtn.style.borderRadius = '50%';
    fireBtn.style.border = '2px solid rgba(255, 255, 255, 0.3)';
    fireBtn.style.touchAction = 'none';
    document.body.appendChild(fireBtn);

    // Joystick Logic
    let startX = 0;
    let startY = 0;
    
    joystickZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isTouchActive = true;
        const touch = e.changedTouches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        
        // Center knob on touch if inside? No, standard virtual joystick usually centers on touch or is fixed.
        // Let's keep it fixed center for now, but track relative movement.
        // Actually, better to track from center of the zone.
        const rect = joystickZone.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        updateJoystick(touch.clientX, touch.clientY, centerX, centerY);
    }, { passive: false });

    joystickZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.changedTouches[0];
        const rect = joystickZone.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        updateJoystick(touch.clientX, touch.clientY, centerX, centerY);
    }, { passive: false });

    joystickZone.addEventListener('touchend', (e) => {
        e.preventDefault();
        isTouchActive = false;
        touchTurnInput = 0;
        touchForwardInput = 0;
        knob.style.transform = 'translate(-50%, -50%)';
    });

    function updateJoystick(tx, ty, cx, cy) {
        const maxDist = 40;
        let dx = tx - cx;
        let dy = ty - cy;
        
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > maxDist) {
            const angle = Math.atan2(dy, dx);
            dx = Math.cos(angle) * maxDist;
            dy = Math.sin(angle) * maxDist;
        }
        
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        
        // Map to inputs (-1 to 1)
        // X is turn (Left/Right) -> -1 is Left (Right turn?), 1 is Right
        // In game: turnInput += 1 is Left. So negative X is Left.
        // Wait, keys.a (Left) -> turnInput += 1.
        // So Left (-X) should be +1 turnInput.
        touchTurnInput = -(dx / maxDist); 
        
        // Y is forward/back. Up (-Y) is Forward.
        // In game: keys.w (Forward) -> forwardInput -= 1.
        // So Up (-Y) should be -1 forwardInput.
        touchForwardInput = (dy / maxDist);
    }

    // Fire Button Logic
    fireBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        shoot();
        fireBtn.style.background = 'rgba(191, 97, 106, 0.9)';
    }, { passive: false });

    fireBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        fireBtn.style.background = 'rgba(191, 97, 106, 0.6)';
    });
}

// Detect Touch Device
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    createTouchControls();
}

// --- Input Handling ---
const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    arrowup: false,
    arrowdown: false,
    arrowleft: false,
    arrowright: false,
    space: false
};

let mouseX = 0;
let mouseY = 0;
window.addEventListener('mousemove', (e) => {
    if (isPaused) return;
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = (e.clientY / window.innerHeight) * 2 - 1;
});

document.body.addEventListener('mouseleave', () => {
    mouseX = 0;
    mouseY = 0;
});

window.addEventListener('blur', () => setPaused(true));
window.addEventListener('focus', () => setPaused(false));

let mouseDownTime = 0;
window.addEventListener('mousedown', () => {
    mouseDownTime = Date.now();
});
window.addEventListener('mouseup', () => {
    if (Date.now() - mouseDownTime < 200) {
        shoot();
    }
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !keys.space) {
        shoot();
        keys.space = true;
    }
    if (keys.hasOwnProperty(e.key.toLowerCase())) {
        keys[e.key.toLowerCase()] = true;
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        keys.space = false;
    }
    if (keys.hasOwnProperty(e.key.toLowerCase())) {
        keys[e.key.toLowerCase()] = false;
    }
});

function spawnReinforcements(count = 2) {
    for (let i = 0; i < count; i++) {
        for (let attempt = 0; attempt < 50; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 50 + Math.random() * 100; // 50-150 units away
            
            const x = tank.mesh.position.x + Math.cos(angle) * dist;
            const z = tank.mesh.position.z + Math.sin(angle) * dist;
            
            const h = getTerrainHeight(x, z);
            
            // Only spawn on flat ground (height 0)
            if (Math.abs(h) < 0.1) {
                const gx = Math.round(x / VOXEL_SIZE);
                const gz = Math.round(z / VOXEL_SIZE);
                
                // Double check no block above
                const hillKey = getVoxelKey(gx, 1, gz);
                if (!voxelMap.has(hillKey)) {
                    const pos = new THREE.Vector3(gx * VOXEL_SIZE, 0, gz * VOXEL_SIZE);
                    createEnemyTank(pos);
                    break;
                }
            }
        }
    }
}

// --- Camera Occlusion ---
const cameraRaycaster = new THREE.Raycaster();
const fadedObjects = new Map(); // Key: voxelKey, Value: { restoreOps: [], tempMeshes: [] }

function updateCameraOcclusion() {
    const tankPos = tank.mesh.position.clone().add(new THREE.Vector3(0, 2, 0));
    const camPos = camera.position;
    const dir = tankPos.clone().sub(camPos).normalize();
    const dist = tankPos.distanceTo(camPos);

    cameraRaycaster.set(camPos, dir);
    
    const activeKeys = new Set();

    // Helper to fade a voxel
    const fadeVoxel = (key) => {
        if (!voxelMap.has(key)) return;
        activeKeys.add(key);

        if (!fadedObjects.has(key)) {
            const data = voxelMap.get(key);
            const restoreOps = [];
            const tempMeshes = [];

            const processPart = (mesh, index) => {
                const matrix = new THREE.Matrix4();
                mesh.getMatrixAt(index, matrix);
                
                // Store restore op
                const originalMatrix = matrix.clone();
                restoreOps.push(() => {
                    mesh.setMatrixAt(index, originalMatrix);
                    mesh.instanceMatrix.needsUpdate = true;
                });

                // Hide instance
                const hiddenMatrix = matrix.clone().scale(new THREE.Vector3(0,0,0));
                mesh.setMatrixAt(index, hiddenMatrix);
                mesh.instanceMatrix.needsUpdate = true;

                // Create transparent clone
                const mat = mesh.material.clone();
                mat.transparent = true;
                mat.opacity = 0.2;
                
                if (mesh.instanceColor) {
                     const color = new THREE.Color();
                     mesh.getColorAt(index, color);
                     mat.color.multiply(color);
                }
                
                const tempMesh = new THREE.Mesh(mesh.geometry, mat);
                const pos = new THREE.Vector3();
                const quat = new THREE.Quaternion();
                const scale = new THREE.Vector3();
                originalMatrix.decompose(pos, quat, scale);
                
                tempMesh.position.copy(pos);
                tempMesh.quaternion.copy(quat);
                tempMesh.scale.copy(scale);
                
                tempMesh.userData = { voxelKey: key };
                
                scene.add(tempMesh);
                tempMeshes.push(tempMesh);
            };

            processPart(data.mesh, data.index);
            if (data.parts) {
                data.parts.forEach(p => processPart(p.mesh, p.index));
            }

            fadedObjects.set(key, { restoreOps, tempMeshes });
        }
    };

    // Check hits
    const tempMeshes = [];
    fadedObjects.forEach(data => tempMeshes.push(...data.tempMeshes));
    
    const objectsToTest = [...worldGroup.children, ...tempMeshes];
    const hits = cameraRaycaster.intersectObjects(objectsToTest);

    for (const hit of hits) {
        if (hit.distance > dist - 2) break; // Don't fade if close to tank

        let key;
        if (hit.object.userData.voxelKey) {
            key = hit.object.userData.voxelKey;
        } else if (hit.instanceId !== undefined) {
            // Use lookup
            const map = instanceLookup.get(hit.object.uuid);
            if (map && map.has(hit.instanceId)) {
                key = map.get(hit.instanceId);
            }
        }

        if (key) fadeVoxel(key);
    }

    // Check camera position (in case we are inside a block)
    const camGx = Math.round(camPos.x / VOXEL_SIZE);
    const camGy = Math.round((camPos.y + VOXEL_SIZE/2) / VOXEL_SIZE);
    const camGz = Math.round(camPos.z / VOXEL_SIZE);
    const camKey = getVoxelKey(camGx, camGy, camGz);
    fadeVoxel(camKey);

    // Restore objects
    for (const [key, data] of fadedObjects) {
        if (!activeKeys.has(key)) {
            data.restoreOps.forEach(op => op());
            data.tempMeshes.forEach(m => {
                scene.remove(m);
                m.material.dispose();
            });
            fadedObjects.delete(key);
        }
    }
}

// --- Game Loop ---
const clock = new THREE.Clock();
let lastPeriodicSpawnTime = 0;

function animate() {
    if (isGameOver) return;
    requestAnimationFrame(animate);

    let delta = clock.getDelta();
    // Cap delta to prevent jitter/physics explosions after pauses or tab switches
    delta = Math.min(delta, 0.1);

    if (isPaused) return;

    const now = clock.getElapsedTime();
    
    // Update Indicator (Barrel Color)
    if (now - lastFireTime >= FIRE_COOLDOWN) {
        tank.barrel.material.color.setHex(0x88C0D0); // Nord8 (Original Blue/Ready)
    }

    // Sky follows tank
    sky.position.copy(tank.mesh.position);

    // Light follows tank
    dirLight.position.set(tank.mesh.position.x + 50, tank.mesh.position.y + 100, tank.mesh.position.z + 50);
    dirLight.target.position.copy(tank.mesh.position);

    // Barrel Recoil Recovery
    tank.barrel.position.z = THREE.MathUtils.lerp(tank.barrel.position.z, -2.5, 5 * delta);

    // Damage Visuals
    if (tank.damageFlashTime > 0) {
        tank.damageFlashTime -= delta;
        tank.bodyMat.color.setHex(0xECEFF4); // Flash White (Nord6)
    } else {
        const healthRatio = Math.max(0, tank.health / MAX_HEALTH);
        const healthyColor = new THREE.Color(0x5E81AC); // Nord10
        const damagedColor = new THREE.Color(0xBF616A); // Nord11
        
        const targetColor = damagedColor.clone().lerp(healthyColor, healthRatio);
        tank.bodyMat.color.lerp(targetColor, 2.0 * delta);
    }

    // Flash Overlay Fade
    if (flashTime > 0) {
        flashTime -= delta;
        flashOverlay.style.opacity = Math.max(0, flashTime / 0.3);
    }

    updateChunks();
    updateCameraOcclusion();
    updateRadar();
    updateParticles(delta);
    updateExhaust(delta);
    updateTrackMarks(delta);
    spawnTrackMarks(tank);

    // Recoil Physics
    if (recoilVelocity.lengthSq() > 0.1) {
        const move = recoilVelocity.clone().multiplyScalar(delta);
        const targetPos = tank.mesh.position.clone().add(move);
        
        // Try to push blocks (recoil can push too!)
        attemptPush(targetPos, move);

        if (!checkEnvironmentCollision(targetPos, tank.mesh.quaternion)) {
            tank.mesh.position.copy(targetPos);
        }
        recoilVelocity.multiplyScalar(Math.max(0, 1 - 5 * delta)); // Damping
    }

    resolveEntityCollisions();

    // Cleanup Far Entities
    const cleanupDist = (DRAW_DISTANCE + 5) * CHUNK_SIZE;
    // Enemies persist (no cleanup)
    
    for (let i = civilians.length - 1; i >= 0; i--) {
        if (civilians[i].mesh.position.distanceTo(tank.mesh.position) > cleanupDist) {
            scene.remove(civilians[i].mesh);
            civilians.splice(i, 1);
        }
    }

    // Civilian Logic
    civilians.forEach(civ => {
        const moveAmount = civ.speed * delta;
        const direction = new THREE.Vector3(1, 0, 0); // Car model faces +X
        direction.applyQuaternion(civ.mesh.quaternion);
        
        const targetPos = civ.mesh.position.clone().addScaledVector(direction, moveAmount);
        
        // Check collision
        if (!checkEnvironmentCollision(targetPos, civ.mesh.quaternion)) {
            civ.mesh.position.copy(targetPos);
        } else {
            // Blocked: Reverse direction (180 degrees)
            // Cars on roads should just go back and forth, not turn 90 degrees into buildings
            civ.mesh.rotateY(Math.PI);
        }
        
        // Gravity
        const h = getTerrainHeight(civ.mesh.position.x, civ.mesh.position.z);
        if (h > -50) {
            // Match static car height (approx 1.4 above ground level 0)
            // If h is 0, y should be 1.4.
            civ.mesh.position.y = THREE.MathUtils.lerp(civ.mesh.position.y, h + 1.4, 0.1);
        } else {
            civ.mesh.position.y -= 9.8 * delta;
        }
    });

    // Enemy Logic
    enemies.forEach(enemy => {
        const toPlayer = tank.mesh.position.clone().sub(enemy.mesh.position);
        toPlayer.y = 0;
        const dist = toPlayer.length();
        
        let moveAmount = 0;
        let rotationAmount = 0;

        // Activity Cycle: 3s Active, 1s Idle (75% Active)
        const isAlerted = now < enemy.alertedUntil;
        const isActive = isAlerted || ((now + (enemy.offset || 0)) % 4) < 3;
        const isFar = dist > RADAR_RANGE;

        if (isFar || (isActive && dist > 6)) { 
            toPlayer.normalize();
            
            // Calculate angle to player
            const localForward = new THREE.Vector3(0, 0, -1);
            localForward.applyQuaternion(enemy.mesh.quaternion);
            
            const angleToTarget = Math.atan2(toPlayer.x, toPlayer.z);
            const currentAngle = Math.atan2(localForward.x, localForward.z);
            
            let diff = angleToTarget - currentAngle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            
            // Check Blind Spot
            // If hasBlindSpot is true, only engage if player is within ~60 degrees (approx 1.0 radian)
            // Ignore blind spot if far away (force pursue) or alerted
            let canSee = true;
            if (!isFar && !isAlerted && enemy.hasBlindSpot && Math.abs(diff) > 1.0) {
                canSee = false;
            }

            // Always turn towards player if seen
            if (canSee && Math.abs(diff) > 0.1) {
                rotationAmount = Math.sign(diff) * TANK_ROTATION_SPEED * delta;
                if (Math.abs(rotationAmount) > Math.abs(diff)) rotationAmount = diff;
                enemy.mesh.rotateY(rotationAmount);
            }

            // Flash if aiming at player
            if (canSee && Math.abs(diff) < 0.3) {
                const flash = (Math.sin(now * 20) + 1) / 2;
                enemy.turretMat.emissive.setHex(0xD08770); // Nord12 (Orange - closer to Red)
                enemy.turretMat.emissiveIntensity = flash * 0.5;
            } else {
                enemy.turretMat.emissiveIntensity = 0;
            }
            
            // Move if roughly facing (widened angle slightly)
            if (canSee && Math.abs(diff) < 0.5) {
                moveAmount = ENEMY_SPEED * delta;
                const direction = new THREE.Vector3(0, 0, -1);
                direction.applyQuaternion(enemy.mesh.quaternion);
                
                const targetPos = enemy.mesh.position.clone().addScaledVector(direction, moveAmount);
                if (!checkEnvironmentCollision(targetPos, enemy.mesh.quaternion)) {
                    enemy.mesh.position.copy(targetPos);
                }

                // Shoot if facing player
                if (Math.abs(diff) < 0.1) {
                    enemyShoot(enemy);
                }

                // Exhaust
                if (Math.random() > 0.8) {
                    const offset = new THREE.Vector3(1.4, 3.8, 2.2);
                    offset.applyMatrix4(enemy.innerMesh.matrixWorld);
                    createExhaust(offset);
                    
                    const offset2 = new THREE.Vector3(-1.4, 3.8, 2.2);
                    offset2.applyMatrix4(enemy.innerMesh.matrixWorld);
                    createExhaust(offset2);
                }
            }
        } else {
            enemy.turretMat.emissiveIntensity = 0;
        }
        
        // Animate Tracks
        const forwardInput = -moveAmount; 
        const trackDist = rotationAmount * 2.2;
        
        const leftMove = forwardInput + trackDist;
        const rightMove = forwardInput - trackDist;
        
        enemy.leftTrackTexture.offset.y += leftMove * 0.1;
        enemy.rightTrackTexture.offset.y += rightMove * 0.1;
        
        // Gravity
        const h = getTerrainHeight(enemy.mesh.position.x, enemy.mesh.position.z);
        if (h > -50) {
            enemy.mesh.position.y = THREE.MathUtils.lerp(enemy.mesh.position.y, h, 0.1);
        } else {
            enemy.mesh.position.y -= 9.8 * delta;
        }
        
        spawnTrackMarks(enemy);
    });

    // Tank Movement
    const moveSpeed = TANK_SPEED * delta;
    const rotSpeed = TANK_ROTATION_SPEED * delta;
    const mouseSensitivity = 1.75;
    
    let turnInput = 0;
    const isKeyboardTurning = keys.a || keys.arrowleft || keys.d || keys.arrowright;

    if (isKeyboardTurning) {
        if (keys.a || keys.arrowleft) turnInput += 1;
        if (keys.d || keys.arrowright) turnInput -= 1;
        mouseX = 0; // Reset mouse input so it doesn't snap back when keys are released
    } else if (isTouchActive) {
        turnInput = touchTurnInput;
    } else {
        if (Math.abs(mouseX) > 0.1) turnInput -= mouseX * mouseSensitivity;
    }
    
    // Clamp
    turnInput = Math.max(-1, Math.min(1, turnInput));

    let rotation = turnInput * rotSpeed;

    // --- Aim Assist ---
    const AIM_ASSIST_ANGLE = isTouchActive ? 0.4 : 0.2; // Wider angle for touch (~22 deg vs ~11 deg)
    const SNAP_SPEED = rotSpeed * 2.0;
    let bestEnemy = null;
    let minAngle = Infinity;
    let targetDir = null;
    
    const tankForward = new THREE.Vector3(0, 0, -1).applyQuaternion(tank.mesh.quaternion);

    enemies.forEach(enemy => {
        const dist = tank.mesh.position.distanceTo(enemy.mesh.position);
        if (dist > RADAR_RANGE) return; 

        // Predict position (Lead the target)
        const timeToHit = dist / PLAYER_PROJECTILE_SPEED;
        let predictedPos = enemy.mesh.position.clone();
        
        // Enemies stop at dist < 6. If further, assume they are moving.
        if (dist > 10) { 
             const enemyForward = new THREE.Vector3(0, 0, -1).applyQuaternion(enemy.mesh.quaternion);
             predictedPos.addScaledVector(enemyForward, ENEMY_SPEED * timeToHit);
        }

        const toTarget = predictedPos.sub(tank.mesh.position);
        toTarget.y = 0;
        toTarget.normalize();

        const angle = tankForward.angleTo(toTarget);

        if (angle < AIM_ASSIST_ANGLE && angle < minAngle) {
            minAngle = angle;
            bestEnemy = enemy;
            targetDir = toTarget;
        }
    });

    if (bestEnemy && targetDir) {
        const crossY = tankForward.z * targetDir.x - tankForward.x * targetDir.z;
        
        // Smoothly interpolate towards the target
        // Calculate a "magnetic" pull based on angle
        const assistFactor = isTouchActive ? 0.6 : 0.15; // Stronger pull for touch
        let assistRotation = minAngle * Math.sign(crossY) * assistFactor;
        
        // Limit assist speed to avoid snapping too hard
        const maxAssist = rotSpeed * 0.5; 
        assistRotation = Math.max(-maxAssist, Math.min(maxAssist, assistRotation));

        // If user is manually turning
        // Increased threshold to 0.2 for touch to allow for slight touch inaccuracies when driving straight
        const manualThreshold = isTouchActive ? 0.2 : 0.05;
        if (Math.abs(turnInput) > manualThreshold) {
            const userDir = Math.sign(turnInput);
            const assistDir = Math.sign(assistRotation);
            
            // If user is fighting the assist (turning away from target), 
            // drastically reduce assist to let them break free easily.
            if (userDir !== assistDir && assistDir !== 0) {
                assistRotation *= 0.05; // Almost disable assist
            } else {
                // User is turning into the assist. 
                // Reduce assist slightly so it doesn't feel like "acceleration"
                assistRotation *= 0.5;
            }
        }
        
        // Apply assist
        rotation += assistRotation;
        
        // Clamp total rotation to reasonable limits
        rotation = Math.max(-rotSpeed * 1.5, Math.min(rotSpeed * 1.5, rotation));
    }

    if (rotation !== 0) {
        const nextQuat = tank.mesh.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), rotation));
        if (!checkTankCollision(tank.mesh.position, nextQuat)) {
            tank.mesh.rotateY(rotation);
        }
    }

    let forwardInput = 0;
    const isKeyboardMoving = keys.w || keys.arrowup || keys.s || keys.arrowdown;

    if (isTouchActive) {
        forwardInput = touchForwardInput;
    } else if (isKeyboardMoving) {
        if (keys.w || keys.arrowup) forwardInput -= 1;
        if (keys.s || keys.arrowdown) forwardInput += 1;
        mouseY = 0; // Reset mouse input
    } else {
        if (Math.abs(mouseY) > 0.1) forwardInput += mouseY * mouseSensitivity;
    }
    
    forwardInput = Math.max(-1, Math.min(1, forwardInput));
    
    // Momentum & Pitch
    const targetSpeed = forwardInput * TANK_SPEED;
    tank.currentSpeed = THREE.MathUtils.lerp(tank.currentSpeed, targetSpeed, 5 * delta);

    // Exhaust
    if (Math.abs(tank.currentSpeed) > 1.0) {
        if (Math.random() > 0.7) {
             const offset = new THREE.Vector3(1.4, 3.8, 2.2);
             offset.applyMatrix4(tank.innerMesh.matrixWorld);
             createExhaust(offset);
             
             const offset2 = new THREE.Vector3(-1.4, 3.8, 2.2);
             offset2.applyMatrix4(tank.innerMesh.matrixWorld);
             createExhaust(offset2);
        }
    }

    // Low Health Smoke
    if (tank.health <= 2 && Math.random() > 0.8) {
         const offset = new THREE.Vector3((Math.random()-0.5)*2, 2, (Math.random()-0.5)*2);
         offset.applyMatrix4(tank.mesh.matrixWorld);
         createExhaust(offset);
    }
    
    // Calculate acceleration (difference between target and current)
    // If accelerating forward (target < current), diff is negative. Pitch should be positive (nose up).
    // If braking (target > current), diff is positive. Pitch should be negative (nose down).
    const accel = (targetSpeed - tank.currentSpeed);
    const targetPitch = -accel * 0.015; // Scale factor
    
    // Smoothly apply pitch
    tank.innerMesh.rotation.x = THREE.MathUtils.lerp(tank.innerMesh.rotation.x, targetPitch, 10 * delta);

    let forward = tank.currentSpeed * delta;

    // Animate tracks
    // Tank width approx 4.4, radius 2.2
    const trackDist = rotation * 2.2;
    const leftMove = forward + trackDist;
    const rightMove = forward - trackDist;
    
    tank.leftTrackTexture.offset.y += leftMove * 0.1;
    tank.rightTrackTexture.offset.y += rightMove * 0.1;

    if (forward !== 0) {
        const direction = new THREE.Vector3(0, 0, forward);
        direction.applyQuaternion(tank.mesh.quaternion);
        
        const currentPos = tank.mesh.position.clone();
        const targetPos = currentPos.clone().add(direction);
        
        // Try to push blocks
        attemptPush(targetPos, direction);

        if (!checkTankCollision(targetPos, tank.mesh.quaternion)) {
            tank.mesh.position.copy(targetPos);
        } else {
            // Slide
            const slideX = currentPos.clone().add(new THREE.Vector3(direction.x, 0, 0));
            if (!checkTankCollision(slideX, tank.mesh.quaternion)) {
                tank.mesh.position.copy(slideX);
            } else {
                const slideZ = currentPos.clone().add(new THREE.Vector3(0, 0, direction.z));
                if (!checkTankCollision(slideZ, tank.mesh.quaternion)) {
                    tank.mesh.position.copy(slideZ);
                }
            }
        }
    }
    
    // Terrain following
    const tankPos = tank.mesh.position;
    
    // Multi-Point Suspension: Check 4 corners of the tank
    // Tank is approx 4 wide, 6 long. We check slightly inside the tracks.
    const corners = [
        new THREE.Vector3(1.5, 0, 2.5),  // Back Left
        new THREE.Vector3(-1.5, 0, 2.5), // Back Right
        new THREE.Vector3(1.5, 0, -2.5), // Front Left
        new THREE.Vector3(-1.5, 0, -2.5) // Front Right
    ];
    
    let bestHeight = -100;
    const stepHeight = 2.5; // Max climbable height (half a block)

    for (const p of corners) {
        // Transform local corner to world space
        const worldP = p.clone().applyQuaternion(tank.mesh.quaternion).add(tankPos);
        const h = getTerrainHeight(worldP.x, worldP.z);
        
        // Filter: Only consider heights that are not "walls" (too high above us)
        // But allow snapping up if we are slightly below (sinking correction)
        if (h <= tankPos.y + stepHeight) {
            if (h > bestHeight) bestHeight = h;
        }
    }
    
    // Fallback to center if no valid corners found (e.g. deep hole or stuck)
    if (bestHeight === -100) {
        bestHeight = getTerrainHeight(tankPos.x, tankPos.z);
    }

    const terrainHeight = bestHeight;
    
    // Simple gravity/snap to ground
    if (terrainHeight > -50) { // If on map
        // Always try to stay on top of the terrain
        // If we are below the terrain (sinking) or slightly above (floating), snap to it.
        
        // Use a faster lerp if we are significantly below ground (recovery)
        const diff = Math.abs(tank.mesh.position.y - terrainHeight);
        const lerpFactor = diff > 1.0 ? 0.2 : 0.1;
        
        tank.mesh.position.y = THREE.MathUtils.lerp(tank.mesh.position.y, terrainHeight, lerpFactor);
    } else {
        // Fall if off map
        tank.mesh.position.y -= 9.8 * delta;
    }

    // Projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.position.addScaledVector(p.userData.velocity, delta);
        
        // Collision Detection
        const gx = Math.round(p.position.x / VOXEL_SIZE);
        const gy = Math.round((p.position.y + VOXEL_SIZE/2) / VOXEL_SIZE);
        const gz = Math.round(p.position.z / VOXEL_SIZE);
        const key = getVoxelKey(gx, gy, gz);

        if (voxelMap.has(key)) {
            // Alert enemies if player shot hits anything near them
            if (p.userData.owner === 'player') {
                const alertRadius = 50;
                enemies.forEach(e => {
                    if (e.mesh.position.distanceTo(p.position) < alertRadius) {
                        e.alertedUntil = clock.getElapsedTime() + 10; // Alert for 10s
                    }
                });
            }

            const { mesh, index, parts } = voxelMap.get(key);
            
            // Explosion Effect
            const color = new THREE.Color();
            if (mesh.instanceColor) mesh.getColorAt(index, color);

            // Indestructible: Blue blocks or Ground Level (Road/Dirt)
            if (color.getHex() === BLUE_COLOR.getHex() || gy === 0) {
                createRicochet(p.position, p.userData.velocity);
                scene.remove(p);
                projectiles.splice(i, 1);
                continue;
            }

            const blockPos = new THREE.Vector3(gx * VOXEL_SIZE, (gy * VOXEL_SIZE) - (VOXEL_SIZE/2), gz * VOXEL_SIZE);
            createExplosion(blockPos, color);

            // Hide the voxel (scale to 0)
            const matrix = new THREE.Matrix4();
            mesh.getMatrixAt(index, matrix);
            const pos = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            matrix.decompose(pos, quat, scale);
            scale.set(0, 0, 0);
            matrix.compose(pos, quat, scale);
            mesh.setMatrixAt(index, matrix);
            mesh.instanceMatrix.needsUpdate = true;

            if (parts) {
                parts.forEach(p => {
                    p.mesh.setMatrixAt(p.index, matrix);
                    p.mesh.instanceMatrix.needsUpdate = true;
                });
            }

            // Remove from map and update height
            unregisterInstance(mesh, index);
            if (parts) {
                parts.forEach(p => unregisterInstance(p.mesh, p.index));
            }
            voxelMap.delete(key);
            updateHeightMap(gx, gz);

            // Remove projectile
            scene.remove(p);
            projectiles.splice(i, 1);
            continue;
        }

        // Remove if too far
        if (p.position.distanceTo(tank.mesh.position) > 100) {
            scene.remove(p);
            projectiles.splice(i, 1);
            continue;
        }

        // Check Enemy Collision
        let hitEnemy = false;
        if (p.userData.owner === 'player') {
            // Check Enemies
            for (let j = enemies.length - 1; j >= 0; j--) {
                const enemy = enemies[j];
                // Use a raised center point for collision to account for tank height
                const enemyCenter = enemy.mesh.position.clone().add(new THREE.Vector3(0, 2, 0));
                if (p.position.distanceTo(enemyCenter) < 3.5) {
                    createExplosion(enemy.mesh.position, new THREE.Color(0xBF616A)); // Red explosion
                    
                    // Death Smoke
                    for (let k = 0; k < 30; k++) {
                        const smokePos = enemy.mesh.position.clone().add(new THREE.Vector3(
                            (Math.random() - 0.5) * 4,
                            Math.random() * 3,
                            (Math.random() - 0.5) * 4
                        ));
                        createExhaust(smokePos);
                    }

                    scene.remove(enemy.mesh);
                    enemies.splice(j, 1);
                    
                    killCount++;
                    
                    if (killCount % 5 === 0 && tank.health < MAX_HEALTH) {
                        tank.health++;
                        triggerHealthFlash(false);
                        updateHealthUI();
                    }

                    updateKillCountDisplay();
                    spawnReinforcements(2);

                    scene.remove(p);
                    projectiles.splice(i, 1);
                    hitEnemy = true;
                    break;
                }
            }
            // Check Civilians
            if (!hitEnemy) {
                for (let j = civilians.length - 1; j >= 0; j--) {
                    const civ = civilians[j];
                    if (p.position.distanceTo(civ.mesh.position) < 4) {
                        createExplosion(civ.mesh.position, civ.color);
                        
                        // Death Smoke
                        for (let k = 0; k < 15; k++) {
                            const smokePos = civ.mesh.position.clone().add(new THREE.Vector3(
                                (Math.random() - 0.5) * 4,
                                Math.random() * 3,
                                (Math.random() - 0.5) * 4
                            ));
                            createExhaust(smokePos);
                        }

                        scene.remove(civ.mesh);
                        civilians.splice(j, 1);
                        
                        scene.remove(p);
                        projectiles.splice(i, 1);
                        hitEnemy = true;
                        break;
                    }
                }
            }
        } else if (p.userData.owner === 'enemy') {
            // Warning Flash for incoming rounds
            if (!p.userData.warned && p.position.distanceTo(tank.mesh.position) < 20) {
                triggerDirectionalFlash(p.position);
                p.userData.warned = true;
            }

            const tankCenter = tank.mesh.position.clone().add(new THREE.Vector3(0, 2, 0));
            if (p.position.distanceTo(tankCenter) < 3.5) {
                createExplosion(tank.mesh.position, new THREE.Color(0x5E81AC)); // Blue explosion
                
                takeDamage();

                scene.remove(p);
                projectiles.splice(i, 1);
                hitEnemy = true;
            }
        }
        if (hitEnemy) continue;
    }

    // Camera Follow
    // Position camera behind and above tank
    const relativeCameraOffset = new THREE.Vector3(0, 10, 15);
    const cameraOffset = relativeCameraOffset.applyMatrix4(tank.mesh.matrixWorld);
    
    // Smooth camera movement
    camera.position.lerp(cameraOffset, 0.1);
    
    // Look ahead of the tank so the tank is lower on screen
    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(tank.mesh.quaternion);
    const lookTarget = tank.mesh.position.clone().add(camForward.multiplyScalar(20));
    camera.lookAt(lookTarget);

    // Target Acquisition
    const startPos = new THREE.Vector3(0, 0, -5);
    startPos.applyMatrix4(tank.turret.matrixWorld);
    
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(tank.turret.getWorldQuaternion(new THREE.Quaternion()));

    targetRaycaster.set(startPos, direction);
    
    // Intersect with enemies and world
    const enemyMeshes = enemies.map(e => e.mesh);
    const objectsToTest = [...enemyMeshes, ...worldGroup.children];
    
    const intersects = targetRaycaster.intersectObjects(objectsToTest, true);

    let foundTarget = false;
    if (intersects.length > 0) {
        const firstHit = intersects[0];
        
        // Is it an enemy?
        let hitEnemy = null;
        let obj = firstHit.object;
        while(obj) {
            const enemy = enemies.find(e => e.mesh === obj);
            if (enemy) {
                hitEnemy = enemy;
                break;
            }
            obj = obj.parent;
        }

        if (hitEnemy) {
            foundTarget = true;
            targetIndicator.visible = true;
            targetIndicator.position.copy(hitEnemy.mesh.position);
            targetIndicator.position.y += 5; // Float above
            
            // Animate
            targetIndicator.children[1].position.y = 4 + Math.sin(now * 10) * 0.5; // Bounce arrow
            targetIndicator.children[0].rotation.z += delta * 2; // Spin ring
        }
    }
    
    if (!foundTarget) {
        targetIndicator.visible = false;
    }

    renderer.render(scene, camera);
}

// Handle resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

updateChunks();
spawnReinforcements(10);

animate();
