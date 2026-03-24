import * as THREE from 'three';
import { TetraFighter, randomShapeKey } from './tetromino.js';
import { checkConnection } from './battle.js';
import { AIController } from './ai.js';
import { UIManager } from './ui.js';
import { SculptureBuilder } from './sculpture.js';

// ============================================================
// GAME CONFIG
// ============================================================
const FIELD_WIDTH = 24;
const FIELD_LENGTH = 40;
const PIECES_PER_TEAM = 5;
const GAME_DURATION = 120;
const SPAWN_INTERVAL = 10;
const MAX_PIECES = 8;

const FIELD_BOUNDS = {
    minX: -FIELD_WIDTH / 2,
    maxX: FIELD_WIDTH / 2,
    minZ: -FIELD_LENGTH / 2,
    maxZ: FIELD_LENGTH / 2,
};

// ============================================================
// THREE.JS SETUP
// ============================================================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a1a);
scene.fog = new THREE.FogExp2(0x0a0a1a, 0.012);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 12, -14);
camera.lookAt(0, 0, 5);

// ============================================================
// LIGHTING
// ============================================================
const ambientLight = new THREE.AmbientLight(0x445566, 0.7);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 60;
dirLight.shadow.camera.left = -30;
dirLight.shadow.camera.right = 30;
dirLight.shadow.camera.top = 30;
dirLight.shadow.camera.bottom = -30;
scene.add(dirLight);

const blueAccent = new THREE.PointLight(0x4fc3f7, 0.6, 30);
blueAccent.position.set(-5, 5, -FIELD_LENGTH / 2 + 3);
scene.add(blueAccent);

const redAccent = new THREE.PointLight(0xef5350, 0.6, 30);
redAccent.position.set(5, 5, FIELD_LENGTH / 2 - 3);
scene.add(redAccent);

// ============================================================
// FIELD / ARENA
// ============================================================
function createArena() {
    // Ground — wider to include sculpture areas
    const groundGeo = new THREE.PlaneGeometry(FIELD_WIDTH + 40, FIELD_LENGTH + 10);
    const groundMat = new THREE.MeshPhongMaterial({
        color: 0x111122,
        specular: 0x222244,
        shininess: 20,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid (field area only)
    const gridHelper = new THREE.GridHelper(Math.max(FIELD_WIDTH, FIELD_LENGTH) + 4, 40, 0x1a1a3a, 0x1a1a3a);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Center line
    const centerLineGeo = new THREE.PlaneGeometry(FIELD_WIDTH, 0.15);
    const centerLineMat = new THREE.MeshBasicMaterial({ color: 0x444466, transparent: true, opacity: 0.6 });
    const centerLine = new THREE.Mesh(centerLineGeo, centerLineMat);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = 0.02;
    scene.add(centerLine);

    // Walls
    const wallMat = new THREE.MeshPhongMaterial({
        color: 0x1a1a2e, transparent: true, opacity: 0.3, specular: 0x4444ff,
    });
    const wallH = 3;

    // Side walls (further out to accommodate sculptures)
    [[-1, 0], [1, 0]].forEach(([side]) => {
        const wallGeo = new THREE.BoxGeometry(0.3, wallH, FIELD_LENGTH + 4);
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(side * (FIELD_WIDTH / 2 + 22), wallH / 2, 0);
        scene.add(wall);
    });

    // End walls
    [[0, -1], [0, 1]].forEach(([, side]) => {
        const wallGeo = new THREE.BoxGeometry(FIELD_WIDTH + 44, wallH, 0.3);
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(0, wallH / 2, side * (FIELD_LENGTH / 2 + 2));
        scene.add(wall);

        const glowColor = side === -1 ? 0x4fc3f7 : 0xef5350;
        const glowGeo = new THREE.PlaneGeometry(FIELD_WIDTH, wallH);
        const glowMat = new THREE.MeshBasicMaterial({
            color: glowColor, transparent: true, opacity: 0.08, side: THREE.DoubleSide,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.set(0, wallH / 2, side * (FIELD_LENGTH / 2 + 1.8));
        scene.add(glow);
    });

    // Spawn zone markers
    [-1, 1].forEach(side => {
        const zoneGeo = new THREE.PlaneGeometry(FIELD_WIDTH - 2, 4);
        const zoneColor = side === -1 ? 0x4fc3f7 : 0xef5350;
        const zoneMat = new THREE.MeshBasicMaterial({
            color: zoneColor, transparent: true, opacity: 0.05,
        });
        const zone = new THREE.Mesh(zoneGeo, zoneMat);
        zone.rotation.x = -Math.PI / 2;
        zone.position.set(0, 0.015, side * (FIELD_LENGTH / 2 - 3));
        scene.add(zone);
    });

    // Field boundary lines
    const lineMat = new THREE.LineBasicMaterial({ color: 0x333355, transparent: true, opacity: 0.4 });
    const fieldOutline = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-FIELD_WIDTH / 2, 0.03, -FIELD_LENGTH / 2),
        new THREE.Vector3(FIELD_WIDTH / 2, 0.03, -FIELD_LENGTH / 2),
        new THREE.Vector3(FIELD_WIDTH / 2, 0.03, FIELD_LENGTH / 2),
        new THREE.Vector3(-FIELD_WIDTH / 2, 0.03, FIELD_LENGTH / 2),
        new THREE.Vector3(-FIELD_WIDTH / 2, 0.03, -FIELD_LENGTH / 2),
    ]);
    scene.add(new THREE.Line(fieldOutline, lineMat));
}

createArena();

// ============================================================
// GAME STATE
// ============================================================
let gameRunning = false;
let gameTime = GAME_DURATION;
let blueScore = 0;
let redScore = 0;
let spawnTimer = SPAWN_INTERVAL;

let bluePieces = [];
let redPieces = [];
let playerPiece = null;

const ui = new UIManager();
const blueAI = new AIController();
const redAI = new AIController();
let sculptureBuilder = new SculptureBuilder(scene, FIELD_BOUNDS);

// Game-over showcase state
let showcaseMode = false;
let showcaseTimer = 0;
let showcaseTeam = 'blue';

// Input state
const keys = {};
let cameraAngle = 0;

// ============================================================
// SPAWNING
// ============================================================
function spawnPiece(team) {
    const shapeKey = randomShapeKey();
    const side = team === 'blue' ? -1 : 1;
    const x = (Math.random() - 0.5) * (FIELD_WIDTH - 6);
    const z = side * (FIELD_LENGTH / 2 - 3);
    const pos = new THREE.Vector3(x, 0, z);
    return new TetraFighter(shapeKey, team, pos, scene);
}

function spawnInitialPieces() {
    bluePieces = [];
    redPieces = [];

    for (let i = 0; i < PIECES_PER_TEAM; i++) {
        const bp = spawnPiece('blue');
        bluePieces.push(bp);
        if (i === 0) {
            playerPiece = bp;
            bp.isPlayerControlled = true;
            bp.speed = 5.0;
        }

        const rp = spawnPiece('red');
        redPieces.push(rp);
    }
}

function respawnFighter(fighter) {
    const side = fighter.team === 'blue' ? -1 : 1;
    const x = (Math.random() - 0.5) * (FIELD_WIDTH - 6);
    const z = side * (FIELD_LENGTH / 2 - 3);
    fighter.group.position.set(x, 0, z);
    fighter.velocity.set(0, 0, 0);
    fighter.isRunning = false;
    // Reset facing
    fighter.group.rotation.y = fighter.direction === -1 ? Math.PI : 0;
}

function spawnReinforcements() {
    if (bluePieces.filter(p => p.alive).length < MAX_PIECES) {
        const bp = spawnPiece('blue');
        bluePieces.push(bp);
        ui.notify('Blue reinforcement!');
    }
    if (redPieces.filter(p => p.alive).length < MAX_PIECES) {
        const rp = spawnPiece('red');
        redPieces.push(rp);
    }
}

// ============================================================
// INPUT
// ============================================================
window.addEventListener('keydown', (e) => {
    keys[e.code] = true;

    if (gameRunning && playerPiece && playerPiece.alive) {
        if (e.code === 'KeyQ') {
            playerPiece.rotateBody(-1); // CCW
        } else if (e.code === 'KeyE') {
            playerPiece.rotateBody(1); // CW
        }
    }
});

window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

canvas.addEventListener('click', () => {
    if (!showcaseMode) {
        canvas.requestPointerLock();
    }
});

document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
        // Standard FPS/TPS convention: mouse right = yaw right
        cameraAngle += e.movementX * 0.003;
    }
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
// PLAYER MOVEMENT
// ============================================================
const WALK_SPEED = 2.5;
const SPRINT_SPEED = 5.5;

// Camera forward = direction from camera toward the lookAt point.
// Camera sits BEHIND the player, so forward = toward +Z rotated by cameraAngle.
// Using standard rotation: x = sin(angle), z = cos(angle).
// Right = 90° CW from forward in XZ plane.
function getCameraForward() {
    return new THREE.Vector3(Math.sin(cameraAngle), 0, Math.cos(cameraAngle));
}
function getCameraRight() {
    return new THREE.Vector3(Math.cos(cameraAngle), 0, -Math.sin(cameraAngle));
}

function handlePlayerMovement(dt) {
    if (!playerPiece || !playerPiece.alive) return;

    const moveDir = new THREE.Vector3();
    const forward = getCameraForward();
    const right = getCameraRight();

    if (keys['KeyW']) moveDir.add(forward);
    if (keys['KeyS']) moveDir.sub(forward);
    if (keys['KeyA']) moveDir.sub(right);
    if (keys['KeyD']) moveDir.add(right);

    const isSprinting = keys['ShiftLeft'] || keys['ShiftRight'];
    const speed = isSprinting ? SPRINT_SPEED : WALK_SPEED;

    if (moveDir.length() > 0) {
        moveDir.normalize();
        playerPiece.position.x += moveDir.x * speed * dt;
        playerPiece.position.z += moveDir.z * speed * dt;

        // Track velocity for collision momentum checks
        playerPiece.velocity.set(moveDir.x * speed, 0, moveDir.z * speed);

        playerPiece.position.x = THREE.MathUtils.clamp(
            playerPiece.position.x, FIELD_BOUNDS.minX + 1, FIELD_BOUNDS.maxX - 1
        );
        playerPiece.position.z = THREE.MathUtils.clamp(
            playerPiece.position.z, FIELD_BOUNDS.minZ, FIELD_BOUNDS.maxZ
        );

        // Face movement direction
        const angle = Math.atan2(moveDir.x, moveDir.z);
        playerPiece.group.rotation.y = angle;

        // Animation flags
        playerPiece.isRunning = true;
        playerPiece.isSprinting = isSprinting;
    } else {
        playerPiece.isRunning = false;
        playerPiece.isSprinting = false;
        playerPiece.velocity.set(0, 0, 0);
    }
}

// ============================================================
// CAMERA
// ============================================================
function updateCamera(dt) {
    if (showcaseMode) {
        updateShowcaseCamera(dt);
        return;
    }

    if (!playerPiece || !playerPiece.alive) {
        const t = Date.now() * 0.0003;
        camera.position.set(Math.sin(t) * 20, 15, Math.cos(t) * 20);
        camera.lookAt(0, 0, 0);
        return;
    }

    const pp = playerPiece.position;
    const cameraDistance = 10;
    const cameraHeight = 8;

    // Camera sits behind the player along the forward direction
    const fwd = getCameraForward();
    const idealPos = new THREE.Vector3(
        pp.x - fwd.x * cameraDistance,
        pp.y + cameraHeight,
        pp.z - fwd.z * cameraDistance
    );

    // Responsive follow — 0.5 keeps it snappy with slight smoothing
    camera.position.lerp(idealPos, 0.5);

    // Look ahead of the player
    const lookTarget = new THREE.Vector3(
        pp.x + fwd.x * 3,
        pp.y + 1.5,
        pp.z + fwd.z * 3
    );
    camera.lookAt(lookTarget);
}

function updateShowcaseCamera(dt) {
    showcaseTimer += dt;

    // Pan between the two sculptures
    const cycleDuration = 8; // seconds per sculpture view
    const totalTime = showcaseTimer % (cycleDuration * 2);
    const viewingBlue = totalTime < cycleDuration;

    const targetSculpture = viewingBlue
        ? sculptureBuilder.getSculpture('blue')
        : sculptureBuilder.getSculpture('red');

    const sculpturePos = targetSculpture.position;

    // Orbit around the sculpture
    const orbitSpeed = 0.3;
    const orbitRadius = 8;
    const angle = showcaseTimer * orbitSpeed;

    const idealPos = new THREE.Vector3(
        sculpturePos.x + Math.sin(angle) * orbitRadius,
        sculpturePos.y + 5,
        sculpturePos.z + Math.cos(angle) * orbitRadius
    );

    camera.position.lerp(idealPos, 0.04);

    const lookAt = new THREE.Vector3(sculpturePos.x, sculpturePos.y + 2, sculpturePos.z);
    camera.lookAt(lookAt);
}

// ============================================================
// PHYSICAL BODY COLLISION
// ============================================================
const BODY_RADIUS = 1.4; // Collision radius per fighter

/**
 * Hard position correction — if two fighters overlap, push them apart
 * instantly so bodies never clip through each other. Applies to ALL
 * pairs: teammates, enemies, and the player.
 */
function handleAllBodyCollisions() {
    const allPieces = [...bluePieces, ...redPieces].filter(p => p.alive);

    for (let i = 0; i < allPieces.length; i++) {
        for (let j = i + 1; j < allPieces.length; j++) {
            const a = allPieces[i];
            const b = allPieces[j];

            const dx = a.position.x - b.position.x;
            const dz = a.position.z - b.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const minDist = BODY_RADIUS * 2;

            if (dist < minDist && dist > 0.001) {
                // Hard separation — push apart by half the overlap each
                const overlap = minDist - dist;
                const nx = dx / dist;
                const nz = dz / dist;

                // Player gets less push so controls stay responsive
                const aIsPlayer = a === playerPiece;
                const bIsPlayer = b === playerPiece;
                let aFactor = 0.5;
                let bFactor = 0.5;
                if (aIsPlayer) { aFactor = 0.2; bFactor = 0.8; }
                if (bIsPlayer) { bFactor = 0.2; aFactor = 0.8; }

                a.position.x += nx * overlap * aFactor;
                a.position.z += nz * overlap * aFactor;
                b.position.x -= nx * overlap * bFactor;
                b.position.z -= nz * overlap * bFactor;
            }
        }
    }
}

// ============================================================
// HITBOX COLLISION
// ============================================================
const COLLISION_RADIUS = 1.8;
const COUNTER_ROTATE_WINDOW = 0.15; // 150ms defensive window

// Pending connections awaiting the counter-rotation window
let pendingConnection = null;

function checkHitboxCollisions() {
    // If there's a pending connection, count down the window
    if (pendingConnection) {
        pendingConnection.timer -= 1 / 60; // approximate dt
        if (pendingConnection.timer <= 0) {
            // Window expired — re-check connection
            const { pieceA, pieceB } = pendingConnection;
            if (pieceA.alive && pieceB.alive) {
                const blocksA = pieceA.getWorldBlocks();
                const blocksB = pieceB.getWorldBlocks();
                const result = checkConnection(blocksA, blocksB);

                if (result.connected) {
                    resolveConnection(pieceA, pieceB, result);
                }
                // If rotation broke the connection, they escape
            }
            pendingConnection = null;
        }
        return; // Don't check new collisions while one is pending
    }

    for (const bp of bluePieces) {
        if (!bp.alive) continue;
        for (const rp of redPieces) {
            if (!rp.alive) continue;

            const dist = bp.position.distanceTo(rp.position);
            if (dist < COLLISION_RADIUS) {
                const blocksA = bp.getWorldBlocks();
                const blocksB = rp.getWorldBlocks();
                const result = checkConnection(blocksA, blocksB);

                if (result.connected) {
                    // Start defensive counter-rotation window
                    pendingConnection = {
                        pieceA: bp,
                        pieceB: rp,
                        timer: COUNTER_ROTATE_WINDOW,
                    };
                    return;
                }
            }
        }
    }
}

function resolveConnection(pieceA, pieceB, result) {
    let winner, loser;

    if (result.winnerSide === 'a') {
        // A has more surface contact — A dominates
        winner = pieceA;
        loser = pieceB;
    } else if (result.winnerSide === 'b') {
        // B has more surface contact
        winner = pieceB;
        loser = pieceA;
    } else {
        // Tied surface area — break by momentum
        const aToB = new THREE.Vector3().subVectors(pieceB.position, pieceA.position).normalize();
        const aMomentum = pieceA.velocity.dot(aToB);
        const bMomentum = -pieceB.velocity.dot(aToB);

        if (aMomentum >= bMomentum) {
            winner = pieceA;
            loser = pieceB;
        } else {
            winner = pieceB;
            loser = pieceA;
        }
    }

    ui.flashScreen();

    const shapeData = loser.getShapeData();
    sculptureBuilder.addShape(winner.team, shapeData);

    if (winner.team === 'blue') {
        blueScore++;
    } else {
        redScore++;
    }

    loser.destroy();
    respawnFighter(winner);
}

// ============================================================
// GAME LOOP
// ============================================================
let prevTime = performance.now();

function gameLoop() {
    requestAnimationFrame(gameLoop);

    const now = performance.now();
    const dt = Math.min((now - prevTime) / 1000, 0.05);
    prevTime = now;

    if (showcaseMode) {
        updateCamera(dt);
        renderer.render(scene, camera);
        return;
    }

    if (!gameRunning) {
        // Title screen — slow orbit
        const t = Date.now() * 0.0002;
        camera.position.set(Math.sin(t) * 25, 10, Math.cos(t) * 25);
        camera.lookAt(0, 1, 0);

        // Animate title screen fighters
        [...bluePieces, ...redPieces].forEach(p => p.update(dt, FIELD_BOUNDS));

        renderer.render(scene, camera);
        return;
    }

    // Timer
    gameTime -= dt;
    ui.updateTimer(Math.max(0, gameTime));

    // Spawn reinforcements
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnTimer = SPAWN_INTERVAL;
        spawnReinforcements();
    }

    // Player input
    handlePlayerMovement(dt);

    // Reassign player piece if current one died
    if (playerPiece && !playerPiece.alive) {
        const alivePieces = bluePieces.filter(p => p.alive);
        if (alivePieces.length > 0) {
            playerPiece = alivePieces[0];
            playerPiece.isPlayerControlled = true;
            playerPiece.speed = 5.0;
            ui.notify('Switched to another fighter!');
        } else {
            playerPiece = null;
        }
    }

    // AI
    const blueAIPieces = bluePieces.filter(p => p.alive && p !== playerPiece);
    blueAI.update(dt, blueAIPieces, redPieces.filter(p => p.alive));
    redAI.update(dt, redPieces.filter(p => p.alive), bluePieces.filter(p => p.alive));

    // Update all fighters
    [...bluePieces, ...redPieces].forEach(p => p.update(dt, FIELD_BOUNDS));

    // Physical collisions — bodies can't pass through each other
    handleAllBodyCollisions();

    // Connection check — if shapes fit together on contact, one dies
    checkHitboxCollisions();

    // Update HUD
    const aliveBlue = bluePieces.filter(p => p.alive).length;
    const aliveRed = redPieces.filter(p => p.alive).length;
    ui.updateScores(blueScore, redScore);
    ui.updatePieceCounts(aliveBlue, aliveRed);
    ui.updateArtCounts(
        sculptureBuilder.getShapeCount('blue'),
        sculptureBuilder.getShapeCount('red')
    );

    // Minimap
    ui.updateMinimap(
        bluePieces.filter(p => p.alive),
        redPieces.filter(p => p.alive),
        playerPiece,
        FIELD_BOUNDS
    );

    // Highlight player
    if (playerPiece && playerPiece.alive) {
        playerPiece.setHighlight(true);
    }

    // Check game over
    if (gameTime <= 0 || aliveBlue === 0 || aliveRed === 0) {
        endGame();
    }

    // Camera
    updateCamera(dt);

    renderer.render(scene, camera);
}

// ============================================================
// START / END
// ============================================================
function startGame() {
    // Clean up old pieces
    [...bluePieces, ...redPieces].forEach(p => {
        if (p.alive) p.destroy();
    });

    // Remove old sculptures
    scene.remove(sculptureBuilder.getSculpture('blue'));
    scene.remove(sculptureBuilder.getSculpture('red'));

    gameRunning = true;
    showcaseMode = false;
    showcaseTimer = 0;
    gameTime = GAME_DURATION;
    blueScore = 0;
    redScore = 0;
    spawnTimer = SPAWN_INTERVAL;
    cameraAngle = 0;

    // Fresh sculpture builder
    sculptureBuilder = new SculptureBuilder(scene, FIELD_BOUNDS);

    spawnInitialPieces();

    ui.hideStartScreen();
    ui.hideGameOver();
    ui.showHUD();
    ui.notify('Battle begins! Collect shapes to build your art piece!');

    // Exit pointer lock cleanly
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
}

function endGame() {
    gameRunning = false;

    const blueArt = sculptureBuilder.getShapeCount('blue');
    const redArt = sculptureBuilder.getShapeCount('red');
    const blueWins = blueArt > redArt;

    ui.hideHUD();
    ui.showGameOver(blueWins, blueArt, redArt);

    // Switch to showcase mode — orbit around the winning sculpture
    showcaseMode = true;
    showcaseTimer = 0;
    showcaseTeam = blueWins ? 'blue' : 'red';

    // Exit pointer lock for menu interaction
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
}

// Event listeners
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);

// Title screen eye candy — spawn some fighters that run around
function titleScreenSetup() {
    for (let i = 0; i < 3; i++) {
        const bp = spawnPiece('blue');
        bluePieces.push(bp);
        bp.speed = 2.0;
    }
    for (let i = 0; i < 3; i++) {
        const rp = spawnPiece('red');
        redPieces.push(rp);
        rp.speed = 2.0;
    }
}
titleScreenSetup();

gameLoop();
