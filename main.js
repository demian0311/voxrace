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

// --- Scene Setup ---
const scene = new THREE.Scene();
const HORIZON_COLOR = 0xECEFF4; // Nord6
const SKY_COLOR = 0x81A1C1; // Nord9

scene.fog = new THREE.FogExp2(HORIZON_COLOR, 0.005);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
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

// --- Sky Dome ---
const vertexShader = `
varying vec3 vWorldPosition;
void main() {
    vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const fragmentShader = `
uniform vec3 topColor;
uniform vec3 bottomColor;
uniform float offset;
uniform float exponent;
varying vec3 vWorldPosition;
void main() {
    float h = normalize( vWorldPosition + vec3(0, offset, 0) ).y;
    gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max( h , 0.0), exponent ), 0.0 ) ), 1.0 );
}`;

const skyGeo = new THREE.SphereGeometry(800, 32, 15);
const skyMat = new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    uniforms: {
        topColor: { value: new THREE.Color(SKY_COLOR) },
        bottomColor: { value: new THREE.Color(HORIZON_COLOR) },
        offset: { value: 10 },
        exponent: { value: 2.0 }
    },
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
        lastFireTime: -100 // Initialize cooldown
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

function checkCollision(pos, quat, selfMesh = null) {
    const halfWidth = 2; 
    const halfLength = 3;
    const points = [
        new THREE.Vector3(halfWidth, 1, halfLength),
        new THREE.Vector3(-halfWidth, 1, halfLength),
        new THREE.Vector3(halfWidth, 1, -halfLength),
        new THREE.Vector3(-halfWidth, 1, -halfLength)
    ];
    
    for (const p of points) {
        const worldP = p.clone().applyQuaternion(quat).add(pos);
        const gx = Math.round(worldP.x / VOXEL_SIZE);
        const gy = Math.round((worldP.y + VOXEL_SIZE/2) / VOXEL_SIZE);
        const gz = Math.round(worldP.z / VOXEL_SIZE);
        if (voxelMap.has(getVoxelKey(gx, gy, gz))) return true;
    }
    
    // Check enemies
    for (const enemy of enemies) {
        if (enemy.mesh === selfMesh) continue;
        if (pos.distanceTo(enemy.mesh.position) < 5) return true;
    }

    // Check player
    if (selfMesh !== tank.mesh && pos.distanceTo(tank.mesh.position) < 5) return true;

    return false;
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

    return { mesh: tankGroup, innerMesh: innerGroup, turret: turret, barrel: barrel, leftTrackTexture: leftTrackTexture, rightTrackTexture: rightTrackTexture, currentSpeed: 0 };
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

    // Recoil
    const recoilForce = direction.clone().normalize().negate().multiplyScalar(2);
    recoilVelocity.add(recoilForce);
    
    // Pitch Kick (Nose Up)
    tank.innerMesh.rotation.x += 0.1;
}

function enemyShoot(enemy) {
    const now = clock.getElapsedTime();
    if (now - enemy.lastFireTime < ENEMY_FIRE_COOLDOWN) return;
    
    enemy.lastFireTime = now;

    const projectile = new THREE.Mesh(projectileGeo, projectileMat);
    
    // Start position (approximate barrel tip for enemy)
    // Enemy structure: mesh -> innerMesh -> turret -> barrel
    // We can just use the enemy position + offset rotated by quaternion
    const startPos = new THREE.Vector3(0, 3.25, -2.5); // Turret height + barrel offset
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
        p.userData.velocity.y -= 50 * delta; // Gravity
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
        p.material.opacity = (p.userData.life / 1.5) * 0.6;
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
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = (e.clientY / window.innerHeight) * 2 - 1;
});
document.body.addEventListener('mouseleave', () => {
    mouseX = 0;
    mouseY = 0;
});

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

// --- Game Loop ---
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const now = clock.getElapsedTime();
    
    // Update Indicator (Barrel Color)
    if (now - lastFireTime >= FIRE_COOLDOWN) {
        tank.barrel.material.color.setHex(0x88C0D0); // Nord8 (Original Blue/Ready)
    }

    // Sky follows tank
    sky.position.copy(tank.mesh.position);

    // Barrel Recoil Recovery
    tank.barrel.position.z = THREE.MathUtils.lerp(tank.barrel.position.z, -2.5, 5 * delta);

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

        if (!checkCollision(targetPos, tank.mesh.quaternion, tank.mesh)) {
            tank.mesh.position.copy(targetPos);
        }
        recoilVelocity.multiplyScalar(Math.max(0, 1 - 5 * delta)); // Damping
    }

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
            
            // Turn
            if (Math.abs(diff) > 0.1) {
                rotationAmount = Math.sign(diff) * TANK_ROTATION_SPEED * delta;
                if (Math.abs(rotationAmount) > Math.abs(diff)) rotationAmount = diff;
                enemy.mesh.rotateY(rotationAmount);
            }
            
            // Move if roughly facing
            if (Math.abs(diff) < 0.2) {
                moveAmount = ENEMY_SPEED * delta;
                const direction = new THREE.Vector3(0, 0, -1);
                direction.applyQuaternion(enemy.mesh.quaternion);
                
                const targetPos = enemy.mesh.position.clone().addScaledVector(direction, moveAmount);
                if (!checkCollision(targetPos, enemy.mesh.quaternion, enemy.mesh)) {
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
        tank.mesh.rotateY(rotation);
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

        if (!checkCollision(targetPos, tank.mesh.quaternion, tank.mesh)) {
            tank.mesh.position.copy(targetPos);
        } else {
            // Slide
            const slideX = currentPos.clone().add(new THREE.Vector3(direction.x, 0, 0));
            if (!checkCollision(slideX, tank.mesh.quaternion, tank.mesh)) {
                tank.mesh.position.copy(slideX);
            } else {
                const slideZ = currentPos.clone().add(new THREE.Vector3(0, 0, direction.z));
                if (!checkCollision(slideZ, tank.mesh.quaternion, tank.mesh)) {
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
                    scene.remove(enemy.mesh);
                    enemies.splice(j, 1);
                    
                    scene.remove(p);
                    projectiles.splice(i, 1);
                    hitEnemy = true;
                    break;
                }
            }
        } else if (p.userData.owner === 'enemy') {
            if (p.position.distanceTo(tank.mesh.position) < 4) {
                createExplosion(tank.mesh.position, new THREE.Color(0x5E81AC)); // Blue explosion
                // Visual feedback only for now
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

animate();
