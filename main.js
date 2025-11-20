import * as THREE from 'three';

// --- Configuration ---
const VOXEL_SIZE = 5;
const CHUNK_SIZE = 10;
const DRAW_DISTANCE = 12;
const TANK_SPEED = 20;
const ENEMY_SPEED = 4;
const TANK_ROTATION_SPEED = 2;
const PROJECTILE_SPEED = 30;
const FIRE_COOLDOWN = 2.0; // Seconds
const ENEMY_FIRE_COOLDOWN = 5.0;
const RADAR_RANGE = 150;
const MAX_HEALTH = 5;
let isGameOver = false;
let isPaused = false;
let killCount = 0;

// --- Scene Setup ---
const scene = new THREE.Scene();
const HORIZON_COLOR = 0x88C0D0; // Nord8 (Light Blue)
const SKY_COLOR = 0x5E81AC; // Nord10 (Darker Blue)

scene.fog = new THREE.FogExp2(HORIZON_COLOR, 0.005);

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

    // Enemies
    const invQuat = tank.mesh.quaternion.clone().invert();
    
    enemies.forEach(enemy => {
        const relPos = enemy.mesh.position.clone().sub(tank.mesh.position);
        relPos.applyQuaternion(invQuat);
        
        // relPos.z is forward (negative) / backward (positive)
        // relPos.x is right (positive) / left (negative)
        
        const dist = relPos.length();
        
        if (dist < RADAR_RANGE) {
            const px = cx + relPos.x * scale;
            const py = cy + relPos.z * scale;
            
            radarCtx.fillStyle = '#BF616A'; // Nord11
            radarCtx.beginPath();
            radarCtx.arc(px, py, 5, 0, Math.PI * 2);
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

// --- UI: Health Bar & Vignette ---
const healthBarContainer = document.createElement('div');
healthBarContainer.style.position = 'absolute';
healthBarContainer.style.bottom = '30px';
healthBarContainer.style.left = '50%';
healthBarContainer.style.transform = 'translateX(-50%)';
healthBarContainer.style.width = '400px';
healthBarContainer.style.height = '20px';
healthBarContainer.style.backgroundColor = '#2E3440'; // Nord0
healthBarContainer.style.border = '2px solid #4C566A'; // Nord3
healthBarContainer.style.borderRadius = '4px';
healthBarContainer.style.zIndex = '10';
document.body.appendChild(healthBarContainer);

const healthBarFill = document.createElement('div');
healthBarFill.style.width = '100%';
healthBarFill.style.height = '100%';
healthBarFill.style.backgroundColor = '#A3BE8C'; // Nord14 (Green)
healthBarFill.style.transition = 'width 0.3s, background-color 0.3s';
healthBarContainer.appendChild(healthBarFill);

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

let flashTime = 0;

function updateHealthUI() {
    const pct = Math.max(0, (tank.health / MAX_HEALTH) * 100);
    healthBarFill.style.width = `${pct}%`;
    
    if (tank.health > 3) {
        healthBarFill.style.backgroundColor = '#A3BE8C'; // Green
        vignette.style.boxShadow = 'inset 0 0 0 0 rgba(191, 97, 106, 0.0)';
    } else if (tank.health > 1) {
        healthBarFill.style.backgroundColor = '#EBCB8B'; // Yellow
        vignette.style.boxShadow = 'inset 0 0 50px rgba(191, 97, 106, 0.2)';
    } else {
        healthBarFill.style.backgroundColor = '#BF616A'; // Red
        vignette.style.boxShadow = 'inset 0 0 150px rgba(191, 97, 106, 0.6)';
    }
}

// --- UI: Pause Overlay ---
const pauseOverlay = document.createElement('div');
pauseOverlay.style.position = 'absolute';
pauseOverlay.style.top = '0';
pauseOverlay.style.left = '0';
pauseOverlay.style.width = '100%';
pauseOverlay.style.height = '100%';
pauseOverlay.style.backgroundColor = 'rgba(46, 52, 64, 0.6)'; // Nord0 transparent
pauseOverlay.style.display = 'none';
pauseOverlay.style.justifyContent = 'center';
pauseOverlay.style.alignItems = 'center';
pauseOverlay.style.zIndex = '1000';
pauseOverlay.style.pointerEvents = 'none'; // Let clicks pass through if needed, though usually pause blocks input

const pauseText = document.createElement('div');
pauseText.innerText = 'PAUSED';
pauseText.style.fontFamily = 'sans-serif';
pauseText.style.color = '#ECEFF4'; // Nord6
pauseText.style.fontSize = '48px';
pauseText.style.fontWeight = 'bold';
pauseText.style.letterSpacing = '4px';
pauseText.style.textShadow = '2px 2px 0px #2E3440';
pauseOverlay.appendChild(pauseText);

document.body.appendChild(pauseOverlay);

function setPaused(state) {
    if (isGameOver) return;
    isPaused = state;
    pauseOverlay.style.display = isPaused ? 'flex' : 'none';
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
        offset: { value: 33 },
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

// --- Voxel World Generation ---
const voxelGeometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
const grassMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff }); // White to allow instance colors

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const chunks = new Map(); // Key: "cx,cz", Value: { mesh, keys[] }
const voxelMap = new Map(); // Key: "gx,gy,gz", Value: { mesh, index }
const heightMap = {}; // Key: "gx,gz", Value: height

function getChunkKey(cx, cz) { return `${cx},${cz}`; }
function getVoxelKey(gx, gy, gz) { return `${gx},${gy},${gz}`; }

const COLORS = [
    new THREE.Color(0xA3BE8C), // Nord14 (Green)
    new THREE.Color(0x8FBCBB), // Nord7 (Teal)
    new THREE.Color(0x4C566A), // Nord3 (Dark Grey)
    new THREE.Color(0xE5E9F0)  // Nord5 (Snow)
];
const BLUE_COLOR = new THREE.Color(0x5E81AC); // Nord10
const CLOUD_COLOR = new THREE.Color(0xD8DEE9); // Nord4

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
        turretMat: turretMat
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
    const maxInstances = CHUNK_SIZE * CHUNK_SIZE * 5; // Increased for clouds
    const mesh = new THREE.InstancedMesh(voxelGeometry, grassMaterial, maxInstances);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    // Seeded RNG for consistent terrain
    const seed = (cx * 2654435761) ^ (cz * 2246822507);
    const rng = mulberry32(seed);

    let index = 0;
    const chunkKeys = [];
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;
    
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const gx = startX + x;
            const gz = startZ + z;
            
            // Base ground
            dummy.position.set(gx * VOXEL_SIZE, -VOXEL_SIZE / 2, gz * VOXEL_SIZE);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            
            // Randomize base color (mostly green, some teal/dirt)
            const rand = rng();
            if (rand > 0.95) mesh.setColorAt(index, COLORS[2]); // Dirt
            else if (rand > 0.8) mesh.setColorAt(index, COLORS[1]); // Teal
            else mesh.setColorAt(index, COLORS[0]); // Green
            
            const baseKey = getVoxelKey(gx, 0, gz);
            voxelMap.set(baseKey, { mesh, index });
            chunkKeys.push(baseKey);
            index++;
            
            let height = 0; // Top of base block

            // Random hills
            // Keep center 3x3 flat for spawn
            if ((Math.abs(gx) > 1 || Math.abs(gz) > 1)) {
                const randHeight = rng();
                
                // Level 1 (Chance: ~6%)
                if (randHeight > 0.94) {
                    const isTall = randHeight > 0.97;

                    dummy.position.set(gx * VOXEL_SIZE, VOXEL_SIZE / 2, gz * VOXEL_SIZE);
                    dummy.updateMatrix();
                    mesh.setMatrixAt(index, dummy.matrix);
                    
                    if (isTall) {
                        mesh.setColorAt(index, BLUE_COLOR);
                    } else {
                        // Hills are snowy or teal
                        if (rng() > 0.5) mesh.setColorAt(index, COLORS[3]); // Snow
                        else mesh.setColorAt(index, COLORS[1]); // Teal
                    }
                    
                    const hillKey = getVoxelKey(gx, 1, gz);
                    voxelMap.set(hillKey, { mesh, index });
                    chunkKeys.push(hillKey);
                    index++;
                    height = VOXEL_SIZE; // Top of hill block

                    // Level 2 (Chance: ~3% of total)
                    if (isTall) {
                        dummy.position.set(gx * VOXEL_SIZE, VOXEL_SIZE * 1.5, gz * VOXEL_SIZE);
                        dummy.updateMatrix();
                        mesh.setMatrixAt(index, dummy.matrix);
                        
                        mesh.setColorAt(index, BLUE_COLOR);
                        
                        const l2Key = getVoxelKey(gx, 2, gz);
                        voxelMap.set(l2Key, { mesh, index });
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
                            chunkKeys.push(l3Key);
                            index++;
                            height = VOXEL_SIZE * 3;
                        }
                    }
                }
            }
            
            heightMap[`${gx},${gz}`] = height;

            // Clouds
            // Simple noise-like pattern
            const cloudNoise = Math.sin(gx * 0.1) + Math.sin(gz * 0.15) + Math.sin((gx + gz) * 0.05);
            if (cloudNoise > 1.4) {
                const cloudHeight = 10 + Math.floor(Math.abs(Math.sin(gx * 0.5)) * 3);
                
                dummy.position.set(gx * VOXEL_SIZE, cloudHeight * VOXEL_SIZE, gz * VOXEL_SIZE);
                dummy.updateMatrix();
                mesh.setMatrixAt(index, dummy.matrix);
                mesh.setColorAt(index, CLOUD_COLOR);
                
                const cloudKey = getVoxelKey(gx, cloudHeight, gz);
                voxelMap.set(cloudKey, { mesh, index });
                chunkKeys.push(cloudKey);
                index++;
            }
        }
    }
    
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    worldGroup.add(mesh);
    
    // Spawn Enemy (20% chance per chunk, but not at 0,0)
    if ((cx !== 0 || cz !== 0) && rng() > 0.8) {
        const rx = Math.floor(rng() * CHUNK_SIZE);
        const rz = Math.floor(rng() * CHUNK_SIZE);
        const gx = startX + rx;
        const gz = startZ + rz;
        
        // Ensure we spawn on flat ground (height 0)
        // Check if there is a hill at this location
        const hillKey = getVoxelKey(gx, 1, gz);
        if (!voxelMap.has(hillKey)) {
            const pos = new THREE.Vector3(gx * VOXEL_SIZE, 0, gz * VOXEL_SIZE);
            createEnemyTank(pos);
        }
    }

    return { mesh, keys: chunkKeys };
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
            worldGroup.remove(chunk.mesh);
            chunk.mesh.dispose();
            chunk.keys.forEach(k => voxelMap.delete(k));
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
            const { mesh, index } = voxelMap.get(key);
            const color = new THREE.Color();
            mesh.getColorAt(index, color);
            
            // Check if Snow (Nord5) - Light colored
            if (color.getHex() === COLORS[3].getHex()) {
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
                        dummy.updateMatrix();
                        mesh.setMatrixAt(index, dummy.matrix);
                        mesh.instanceMatrix.needsUpdate = true;
                        
                        voxelMap.delete(key);
                        voxelMap.set(nextKey, { mesh, index });
                        
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
    const points = [
        new THREE.Vector3(2, 1, 3), new THREE.Vector3(-2, 1, 3),
        new THREE.Vector3(2, 1, -3), new THREE.Vector3(-2, 1, -3),
        new THREE.Vector3(2, 1, 0), new THREE.Vector3(-2, 1, 0),
        new THREE.Vector3(0, 1, 3), new THREE.Vector3(0, 1, -3)
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
    const units = [tank, ...enemies];
    const radius = 3.5; 

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

    // Detail: Antenna (Nord4 - White)
    const antennaGeo = new THREE.CylinderGeometry(0.05, 0.05, 4);
    const antennaMat = new THREE.MeshStandardMaterial({ color: 0xD8DEE9 }); // Nord4
    const antenna = new THREE.Mesh(antennaGeo, antennaMat);
    antenna.position.set(-1, 2.0, 1);
    turret.add(antenna);

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
        leftTrackTexture: leftTrackTexture, 
        rightTrackTexture: rightTrackTexture, 
        currentSpeed: 0,
        health: MAX_HEALTH,
        damageFlashTime: 0
    };
}

const tank = createTank();
scene.add(tank.mesh);
tank.mesh.position.set(0, 0, 0); // Start at center, which is now guaranteed flat

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
    
    projectile.userData.velocity = direction.multiplyScalar(PROJECTILE_SPEED);
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
    tank.damageFlashTime = 0.1;
    updateHealthUI();
    
    if (tank.health <= 0) {
        gameOver();
    }
}

function restartGame() {
    const overlay = document.getElementById('gameOverOverlay');
    if (overlay) overlay.remove();

    // Reset Tank
    tank.health = MAX_HEALTH;
    tank.mesh.position.set(0, 0, 0);
    tank.mesh.rotation.set(0, 0, 0);
    tank.innerMesh.rotation.set(0, 0, 0);
    tank.currentSpeed = 0;
    tank.bodyMat.color.setHex(0x5E81AC); // Nord10
    tank.damageFlashTime = 0;
    updateHealthUI();

    killCount = 0;
    updateKillCountDisplay();

    // Clear Enemies
    enemies.forEach(e => scene.remove(e.mesh));
    enemies.length = 0;

    spawnReinforcements(5);
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
    
    const overlay = document.createElement('div');
    overlay.id = 'gameOverOverlay';
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(46, 52, 64, 0.8)'; // Nord0 transparent
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.cursor = 'pointer';
    overlay.style.fontFamily = 'sans-serif';
    
    const text = document.createElement('div');
    text.innerText = 'GAME OVER';
    text.style.color = '#BF616A'; // Nord11
    text.style.fontSize = '64px';
    text.style.fontWeight = 'bold';
    text.style.textShadow = '2px 2px 0px #2E3440';
    overlay.appendChild(text);

    const scoreText = document.createElement('div');
    scoreText.innerText = `Total Kills: ${killCount}`;
    scoreText.style.color = '#EBCB8B'; // Nord13
    scoreText.style.fontSize = '32px';
    scoreText.style.marginTop = '20px';
    scoreText.style.fontWeight = 'bold';
    overlay.appendChild(scoreText);

    const subText = document.createElement('div');
    subText.innerText = 'Click anywhere to Restart';
    subText.style.color = '#ECEFF4'; // Nord6
    subText.style.fontSize = '24px';
    subText.style.marginTop = '20px';
    overlay.appendChild(subText);
    
    overlay.onclick = restartGame;
    
    document.body.appendChild(overlay);
}

function enemyShoot(enemy) {
    const now = clock.getElapsedTime();
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

    createMuzzleFlash(startPos, direction);

    // Screen Flash Indicator
    const toEnemy = enemy.mesh.position.clone().sub(tank.mesh.position);
    toEnemy.applyQuaternion(tank.mesh.quaternion.clone().invert());
    toEnemy.normalize();
    
    // Calculate screen position for flash center (x: right+, z: back+)
    const cx = 50 + toEnemy.x * 60; 
    const cy = 50 + toEnemy.z * 60; 
    
    flashOverlay.style.background = `radial-gradient(circle at ${cx}% ${cy}%, rgba(235, 203, 139, 0.4) 0%, transparent 50%)`;
    flashOverlay.style.opacity = '1';
    flashTime = 0.3;
}

// --- Explosions ---
const particles = [];
const particleGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5); // Debris chunks

function createExplosion(pos, blockColor) {
    const nordRed = new THREE.Color(0xBF616A);
    const nordYellow = new THREE.Color(0xEBCB8B);

    for (let i = 0; i < 8; i++) {
        let pColor = blockColor;
        // Half of the cubes (e.g. even indices) should be red or yellow
        if (i % 2 === 0) {
            pColor = Math.random() > 0.5 ? nordRed : nordYellow;
        }

        const material = new THREE.MeshStandardMaterial({ color: pColor });
        const particle = new THREE.Mesh(particleGeo, material);
        
        // Start at block center with slight random offset
        particle.position.copy(pos).add(new THREE.Vector3(
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3
        ));
        
        // Random velocity outward
        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 20,
            (Math.random() * 20) + 5, // Upward bias
            (Math.random() - 0.5) * 20
        );
        
        particle.userData = { velocity: velocity, life: 1.0 }; // 1 second life
        scene.add(particle);
        particles.push(particle);
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
    const flashGeo = new THREE.BoxGeometry(6.0, 6.0, 6.0);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xEBCB8B, transparent: true, opacity: 0.9 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(pos);
    flash.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    flash.userData = { velocity: new THREE.Vector3(0,0,0), life: 0.15, noGravity: true };
    scene.add(flash);
    particles.push(flash);

    // Smoke Blast
    for (let i = 0; i < 15; i++) {
        const smoke = new THREE.Mesh(exhaustGeo, exhaustMat.clone());
        smoke.position.copy(pos);
        smoke.scale.setScalar(4.0 + Math.random() * 4.0);
        
        // Spread out slightly from muzzle
        smoke.position.add(new THREE.Vector3(
            (Math.random() - 0.5) * 1.0,
            (Math.random() - 0.5) * 1.0,
            (Math.random() - 0.5) * 1.0
        ));

        const speed = 20 + Math.random() * 15;
        const velocity = dir.clone().multiplyScalar(speed);
        
        // Add some randomness to direction (cone)
        velocity.x += (Math.random() - 0.5) * 6;
        velocity.y += (Math.random() - 0.5) * 6;
        velocity.z += (Math.random() - 0.5) * 6;

        smoke.userData = {
            velocity: velocity,
            life: 0.5 + Math.random() * 0.5,
            drag: 3.0
        };
        scene.add(smoke);
        exhaustParticles.push(smoke);
    }
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

// --- Game Loop ---
const clock = new THREE.Clock();
let lastPeriodicSpawnTime = 0;

function animate() {
    if (isGameOver) return;
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    if (isPaused) return;

    const now = clock.getElapsedTime();

    if (now - lastPeriodicSpawnTime > 20) {
        spawnReinforcements(1);
        lastPeriodicSpawnTime = now;
    }
    
    // Update Indicator (Barrel Color)
    if (now - lastFireTime >= FIRE_COOLDOWN) {
        tank.barrel.material.color.setHex(0x88C0D0); // Nord8 (Original Blue/Ready)
    }

    // Sky follows tank
    sky.position.copy(tank.mesh.position);

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

    // Enemy Logic
    enemies.forEach(enemy => {
        const toPlayer = tank.mesh.position.clone().sub(enemy.mesh.position);
        toPlayer.y = 0;
        const dist = toPlayer.length();
        
        let moveAmount = 0;
        let rotationAmount = 0;

        if (dist < 80 && dist > 6) { // Chase if close enough but not touching
            toPlayer.normalize();
            
            // Calculate angle to player
            const localForward = new THREE.Vector3(0, 0, -1);
            localForward.applyQuaternion(enemy.mesh.quaternion);
            
            const angleToTarget = Math.atan2(toPlayer.x, toPlayer.z);
            const currentAngle = Math.atan2(localForward.x, localForward.z);
            
            let diff = angleToTarget - currentAngle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            
            // Only engage if player is in front (within ~60 degrees)
            if (Math.abs(diff) < 1.0) {
                // Turn
                if (Math.abs(diff) > 0.1) {
                    rotationAmount = Math.sign(diff) * TANK_ROTATION_SPEED * delta;
                    if (Math.abs(rotationAmount) > Math.abs(diff)) rotationAmount = diff;
                    enemy.mesh.rotateY(rotationAmount);
                }

                // Flash if aiming at player
                if (Math.abs(diff) < 0.3) {
                    const flash = (Math.sin(now * 20) + 1) / 2;
                    enemy.turretMat.emissive.setHex(0xD08770); // Nord12 (Orange - closer to Red)
                    enemy.turretMat.emissiveIntensity = flash * 0.5;
                } else {
                    enemy.turretMat.emissiveIntensity = 0;
                }
                
                // Move if roughly facing
                if (Math.abs(diff) < 0.2) {
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
    
    let turnInput = 0;
    if (Math.abs(mouseX) > 0.1) turnInput -= mouseX;
    if (keys.a || keys.arrowleft) turnInput += 1;
    if (keys.d || keys.arrowright) turnInput -= 1;
    
    // Clamp
    turnInput = Math.max(-1, Math.min(1, turnInput));

    const rotation = turnInput * rotSpeed;
    if (rotation !== 0) {
        const nextQuat = tank.mesh.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), rotation));
        if (!checkEnvironmentCollision(tank.mesh.position, nextQuat)) {
            tank.mesh.rotateY(rotation);
        }
    }

    let forwardInput = 0;
    if (Math.abs(mouseY) > 0.1) forwardInput += mouseY;
    if (keys.w || keys.arrowup) forwardInput -= 1;
    if (keys.s || keys.arrowdown) forwardInput += 1;
    
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

        if (!checkEnvironmentCollision(targetPos, tank.mesh.quaternion)) {
            tank.mesh.position.copy(targetPos);
        } else {
            // Slide
            const slideX = currentPos.clone().add(new THREE.Vector3(direction.x, 0, 0));
            if (!checkEnvironmentCollision(slideX, tank.mesh.quaternion)) {
                tank.mesh.position.copy(slideX);
            } else {
                const slideZ = currentPos.clone().add(new THREE.Vector3(0, 0, direction.z));
                if (!checkEnvironmentCollision(slideZ, tank.mesh.quaternion)) {
                    tank.mesh.position.copy(slideZ);
                }
            }
        }
    }
    
    // Terrain following
    const tankPos = tank.mesh.position;
    const terrainHeight = getTerrainHeight(tankPos.x, tankPos.z);
    
    // Simple gravity/snap to ground
    if (terrainHeight > -50) { // If on map
        // Smoothly interpolate Y
        tank.mesh.position.y = THREE.MathUtils.lerp(tank.mesh.position.y, terrainHeight, 0.1);
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
            const { mesh, index } = voxelMap.get(key);
            
            // Explosion Effect
            const color = new THREE.Color();
            mesh.getColorAt(index, color);

            if (color.getHex() === BLUE_COLOR.getHex()) {
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

            // Remove from map and update height
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
            for (let j = enemies.length - 1; j >= 0; j--) {
                const enemy = enemies[j];
                if (p.position.distanceTo(enemy.mesh.position) < 4) {
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
                        updateHealthUI();
                    }

                    updateKillCountDisplay();
                    spawnReinforcements();

                    scene.remove(p);
                    projectiles.splice(i, 1);
                    hitEnemy = true;
                    break;
                }
            }
        } else if (p.userData.owner === 'enemy') {
            if (p.position.distanceTo(tank.mesh.position) < 4) {
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
    camera.lookAt(tank.mesh.position);

    renderer.render(scene, camera);
}

// Handle resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

updateChunks();
spawnReinforcements(5);

animate();
