import * as THREE from 'three';

// --- Configuration ---
const VOXEL_SIZE = 5;
const CHUNK_SIZE = 10;
const DRAW_DISTANCE = 4;
const TANK_SPEED = 10;
const TANK_ROTATION_SPEED = 2;
const PROJECTILE_SPEED = 30;
const FIRE_COOLDOWN = 2.0; // Seconds

// --- Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x81A1C1); // Nord9
scene.fog = new THREE.Fog(0x81A1C1, 50, 300); // Nord9

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 20, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

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

function generateChunk(cx, cz) {
    const dummy = new THREE.Object3D();
    const maxInstances = CHUNK_SIZE * CHUNK_SIZE * 2;
    const mesh = new THREE.InstancedMesh(voxelGeometry, grassMaterial, maxInstances);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
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
            const rand = Math.random();
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
            if ((Math.abs(gx) > 1 || Math.abs(gz) > 1) && Math.random() > 0.9) {
                dummy.position.set(gx * VOXEL_SIZE, VOXEL_SIZE / 2, gz * VOXEL_SIZE);
                dummy.updateMatrix();
                mesh.setMatrixAt(index, dummy.matrix);
                
                // Hills are snowy or teal
                if (Math.random() > 0.5) mesh.setColorAt(index, COLORS[3]); // Snow
                else mesh.setColorAt(index, COLORS[1]); // Teal
                
                const hillKey = getVoxelKey(gx, 1, gz);
                voxelMap.set(hillKey, { mesh, index });
                chunkKeys.push(hillKey);
                index++;
                height = VOXEL_SIZE; // Top of hill block
            }
            
            heightMap[`${gx},${gz}`] = height;
        }
    }
    
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    worldGroup.add(mesh);
    
    return { mesh, keys: chunkKeys };
}

function updateChunks() {
    const tankPos = tank.mesh.position;
    const cx = Math.floor(tankPos.x / (VOXEL_SIZE * CHUNK_SIZE));
    const cz = Math.floor(tankPos.z / (VOXEL_SIZE * CHUNK_SIZE));
    
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
    if (voxelMap.has(getVoxelKey(gx, 1, gz))) {
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

function checkCollision(pos) {
    const halfWidth = 2; 
    const halfLength = 3;
    const points = [
        new THREE.Vector3(halfWidth, 1, halfLength),
        new THREE.Vector3(-halfWidth, 1, halfLength),
        new THREE.Vector3(halfWidth, 1, -halfLength),
        new THREE.Vector3(-halfWidth, 1, -halfLength)
    ];
    const quat = tank.mesh.quaternion; // Use current rotation
    
    for (const p of points) {
        const worldP = p.clone().applyQuaternion(quat).add(pos);
        const gx = Math.round(worldP.x / VOXEL_SIZE);
        const gy = Math.round((worldP.y + VOXEL_SIZE/2) / VOXEL_SIZE);
        const gz = Math.round(worldP.z / VOXEL_SIZE);
        if (voxelMap.has(getVoxelKey(gx, gy, gz))) return true;
    }
    return false;
}


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

    // Body
    const bodyGeo = new THREE.BoxGeometry(4, 2, 6);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5E81AC }); // Nord10
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.5; // Lift up so wheels can be below (conceptually)
    body.castShadow = true;
    body.receiveShadow = true;
    tankGroup.add(body);

    // Turret
    const turretGeo = new THREE.BoxGeometry(3, 1.5, 3);
    const turretMat = new THREE.MeshStandardMaterial({ color: 0x88C0D0 }); // Nord8
    const turret = new THREE.Mesh(turretGeo, turretMat);
    turret.position.y = 3.25;
    turret.castShadow = true;
    turret.receiveShadow = true;
    tankGroup.add(turret);

    // Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.3, 0.3, 5, 8);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x88C0D0 }); // Nord8
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, -2.5); // Stick out front
    turret.add(barrel); // Attach to turret

    // Tracks (Visual only)
    const leftTrackTexture = createTrackTexture();
    const rightTrackTexture = createTrackTexture();
    
    const trackGeo = new THREE.BoxGeometry(1, 1.5, 6.5);
    
    const leftTrackMat = new THREE.MeshStandardMaterial({ map: leftTrackTexture });
    const leftTrack = new THREE.Mesh(trackGeo, leftTrackMat);
    leftTrack.position.set(-2.2, 0.75, 0);
    leftTrack.castShadow = true;
    tankGroup.add(leftTrack);

    const rightTrackMat = new THREE.MeshStandardMaterial({ map: rightTrackTexture });
    const rightTrack = new THREE.Mesh(trackGeo, rightTrackMat);
    rightTrack.position.set(2.2, 0.75, 0);
    rightTrack.castShadow = true;
    tankGroup.add(rightTrack);

    return { mesh: tankGroup, turret: turret, barrel: barrel, leftTrackTexture: leftTrackTexture, rightTrackTexture: rightTrackTexture };
}

const tank = createTank();
scene.add(tank.mesh);
tank.mesh.position.set(0, 0, 0); // Start at center, which is now guaranteed flat

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

    updateChunks();
    updateParticles(delta);

    // Tank Movement
    const moveSpeed = TANK_SPEED * delta;
    const rotSpeed = TANK_ROTATION_SPEED * delta;
    
    let rotation = 0;
    if (keys.a || keys.arrowleft) {
        rotation = rotSpeed;
        tank.mesh.rotateY(rotSpeed);
    }
    if (keys.d || keys.arrowright) {
        rotation = -rotSpeed;
        tank.mesh.rotateY(-rotSpeed);
    }

    let forward = 0;
    if (keys.w || keys.arrowup) forward = -moveSpeed;
    if (keys.s || keys.arrowdown) forward = moveSpeed;

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
        
        if (!checkCollision(targetPos)) {
            tank.mesh.position.copy(targetPos);
        } else {
            // Slide
            const slideX = currentPos.clone().add(new THREE.Vector3(direction.x, 0, 0));
            if (!checkCollision(slideX)) {
                tank.mesh.position.copy(slideX);
            } else {
                const slideZ = currentPos.clone().add(new THREE.Vector3(0, 0, direction.z));
                if (!checkCollision(slideZ)) {
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
        }
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
