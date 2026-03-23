import * as THREE from 'three';
import { Tetromino, randomShapeKey } from './tetromino.js';
import { BattleManager } from './battle.js';
import { AIController } from './ai.js';
import { UIManager } from './ui.js';

// ============================================================
// GAME CONFIG
// ============================================================
const FIELD_WIDTH = 24;
const FIELD_LENGTH = 40;
const PIECES_PER_TEAM = 5;
const GAME_DURATION = 120; // seconds
const SPAWN_INTERVAL = 12; // seconds between reinforcement spawns
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
scene.fog = new THREE.FogExp2(0x0a0a1a, 0.018);

// Camera — third person
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 12, -14);
camera.lookAt(0, 0, 5);

// ============================================================
// LIGHTING
// ============================================================
const ambientLight = new THREE.AmbientLight(0x334466, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 60;
dirLight.shadow.camera.left = -25;
dirLight.shadow.camera.right = 25;
dirLight.shadow.camera.top = 25;
dirLight.shadow.camera.bottom = -25;
scene.add(dirLight);

const blueAccent = new THREE.PointLight(0x4fc3f7, 0.8, 30);
blueAccent.position.set(-5, 5, -FIELD_LENGTH / 2 + 3);
scene.add(blueAccent);

const redAccent = new THREE.PointLight(0xef5350, 0.8, 30);
redAccent.position.set(5, 5, FIELD_LENGTH / 2 - 3);
scene.add(redAccent);

// ============================================================
// FIELD / ARENA
// ============================================================
function createArena() {
    // Ground
    const groundGeo = new THREE.PlaneGeometry(FIELD_WIDTH + 4, FIELD_LENGTH + 4);
    const groundMat = new THREE.MeshPhongMaterial({
        color: 0x111122,
        specular: 0x222244,
        shininess: 20,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid lines
    const gridHelper = new THREE.GridHelper(Math.max(FIELD_WIDTH, FIELD_LENGTH) + 4, 40, 0x1a1a3a, 0x1a1a3a);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Center line (glowing)
    const centerLineGeo = new THREE.PlaneGeometry(FIELD_WIDTH, 0.15);
    const centerLineMat = new THREE.MeshBasicMaterial({ color: 0x444466, transparent: true, opacity: 0.6 });
    const centerLine = new THREE.Mesh(centerLineGeo, centerLineMat);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = 0.02;
    scene.add(centerLine);

    // Walls
    const wallMat = new THREE.MeshPhongMaterial({
        color: 0x1a1a2e,
        transparent: true,
        opacity: 0.3,
        specular: 0x4444ff,
    });

    const wallH = 3;
    // Side walls
    [[-1, 0], [1, 0]].forEach(([side]) => {
        const wallGeo = new THREE.BoxGeometry(0.3, wallH, FIELD_LENGTH + 4);
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(side * (FIELD_WIDTH / 2 + 2), wallH / 2, 0);
        scene.add(wall);
    });

    // End walls
    [[0, -1], [0, 1]].forEach(([, side]) => {
        const wallGeo = new THREE.BoxGeometry(FIELD_WIDTH + 4, wallH, 0.3);
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(0, wallH / 2, side * (FIELD_LENGTH / 2 + 2));
        scene.add(wall);

        // Team color glow on end walls
        const glowColor = side === -1 ? 0x4fc3f7 : 0xef5350;
        const glowGeo = new THREE.PlaneGeometry(FIELD_WIDTH, wallH);
        const glowMat = new THREE.MeshBasicMaterial({
            color: glowColor,
            transparent: true,
            opacity: 0.08,
            side: THREE.DoubleSide,
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
            color: zoneColor,
            transparent: true,
            opacity: 0.05,
        });
        const zone = new THREE.Mesh(zoneGeo, zoneMat);
        zone.rotation.x = -Math.PI / 2;
        zone.position.set(0, 0.015, side * (FIELD_LENGTH / 2 - 3));
        scene.add(zone);
    });
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
let playerPiece = null; // The piece the player controls

const ui = new UIManager();
const battleManager = new BattleManager();
const blueAI = new AIController();
const redAI = new AIController();

// Input state
const keys = {};
let mouseX = 0;
let cameraAngle = 0;

// ============================================================
// SPAWNING
// ============================================================
function spawnPiece(team) {
    const shapeKey = randomShapeKey();
    const side = team === 'blue' ? -1 : 1;
    const x = (Math.random() - 0.5) * (FIELD_WIDTH - 4);
    const z = side * (FIELD_LENGTH / 2 - 2);
    const pos = new THREE.Vector3(x, 0, z);
    return new Tetromino(shapeKey, team, pos, scene);
}

function spawnInitialPieces() {
    bluePieces = [];
    redPieces = [];

    for (let i = 0; i < PIECES_PER_TEAM; i++) {
        const bp = spawnPiece('blue');
        bluePieces.push(bp);
        if (i === 0) {
            playerPiece = bp;
            bp.speed = 4.0; // Player is slightly faster
        }

        const rp = spawnPiece('red');
        redPieces.push(rp);
    }
}

function spawnReinforcements() {
    if (bluePieces.filter(p => p.alive).length < MAX_PIECES) {
        const bp = spawnPiece('blue');
        bluePieces.push(bp);
        ui.notify('Blue reinforcement spawned!');
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

    // Battle inputs
    if (gameRunning && playerPiece && playerPiece.inBattle) {
        const battle = battleManager.getPlayerBattle(playerPiece);
        if (battle) {
            if (e.code === 'Space') {
                e.preventDefault();
                battle.playerAttract();
            } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
                e.preventDefault();
                battle.playerRepel();
            }
        }
    }

    // Rotate piece
    if (e.code === 'KeyR' && playerPiece && playerPiece.alive && !playerPiece.inBattle) {
        playerPiece.rotateShape();
    }
});

window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

// Mouse look
canvas.addEventListener('click', () => {
    canvas.requestPointerLock();
});

document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
        cameraAngle -= e.movementX * 0.003;
    }
});

// Window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
// PLAYER MOVEMENT
// ============================================================
function handlePlayerMovement(dt) {
    if (!playerPiece || !playerPiece.alive || playerPiece.inBattle) return;

    const moveDir = new THREE.Vector3();

    // Forward/back relative to camera
    const forward = new THREE.Vector3(Math.sin(cameraAngle), 0, Math.cos(cameraAngle));
    const right = new THREE.Vector3(Math.cos(cameraAngle), 0, -Math.sin(cameraAngle));

    if (keys['KeyW']) moveDir.add(forward);
    if (keys['KeyS']) moveDir.sub(forward);
    if (keys['KeyA']) moveDir.sub(right);
    if (keys['KeyD']) moveDir.add(right);

    if (moveDir.length() > 0) {
        moveDir.normalize();
        playerPiece.position.x += moveDir.x * playerPiece.speed * dt;
        playerPiece.position.z += moveDir.z * playerPiece.speed * dt;

        // Clamp
        playerPiece.position.x = THREE.MathUtils.clamp(
            playerPiece.position.x, FIELD_BOUNDS.minX + 1, FIELD_BOUNDS.maxX - 1
        );
        playerPiece.position.z = THREE.MathUtils.clamp(
            playerPiece.position.z, FIELD_BOUNDS.minZ, FIELD_BOUNDS.maxZ
        );
    }
}

// ============================================================
// CAMERA
// ============================================================
function updateCamera() {
    if (!playerPiece || !playerPiece.alive) {
        // Spectator mode — orbit the field
        const t = Date.now() * 0.0003;
        camera.position.set(Math.sin(t) * 20, 15, Math.cos(t) * 20);
        camera.lookAt(0, 0, 0);
        return;
    }

    const pp = playerPiece.position;

    // Third person: behind and above the player
    const cameraDistance = 10;
    const cameraHeight = 8;

    const idealPos = new THREE.Vector3(
        pp.x - Math.sin(cameraAngle) * cameraDistance,
        pp.y + cameraHeight,
        pp.z - Math.cos(cameraAngle) * cameraDistance
    );

    // Smooth follow
    camera.position.lerp(idealPos, 0.08);

    const lookTarget = new THREE.Vector3(pp.x, pp.y + 1, pp.z);
    // Look slightly ahead
    lookTarget.x += Math.sin(cameraAngle) * 3;
    lookTarget.z += Math.cos(cameraAngle) * 3;

    camera.lookAt(lookTarget);
}

// ============================================================
// COLLISION BETWEEN SAME-TEAM PIECES
// ============================================================
function handleSameTeamAvoidance(pieces, dt) {
    for (let i = 0; i < pieces.length; i++) {
        for (let j = i + 1; j < pieces.length; j++) {
            const a = pieces[i], b = pieces[j];
            if (!a.alive || !b.alive) continue;
            if (a === playerPiece || b === playerPiece) continue; // Don't push player

            const dist = a.position.distanceTo(b.position);
            if (dist < 2.5 && dist > 0.01) {
                const push = new THREE.Vector3().subVectors(a.position, b.position).normalize().multiplyScalar(dt * 2);
                a.position.add(push);
                b.position.sub(push);
            }
        }
    }
}

// ============================================================
// GAME LOOP
// ============================================================
let prevTime = performance.now();

function gameLoop() {
    requestAnimationFrame(gameLoop);

    const now = performance.now();
    const dt = Math.min((now - prevTime) / 1000, 0.05); // Cap delta
    prevTime = now;

    if (!gameRunning) {
        updateCamera();
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
            playerPiece.speed = 4.0;
            ui.notify('Switched to another piece!');
        } else {
            playerPiece = null;
        }
    }

    // AI for non-player pieces
    const blueAIPieces = bluePieces.filter(p => p.alive && p !== playerPiece && !p.inBattle);
    blueAI.update(dt, blueAIPieces, redPieces.filter(p => p.alive));
    redAI.update(dt, redPieces.filter(p => p.alive && !p.inBattle), bluePieces.filter(p => p.alive));

    // Update all pieces
    [...bluePieces, ...redPieces].forEach(p => p.update(dt, FIELD_BOUNDS));

    // Same-team avoidance
    handleSameTeamAvoidance(bluePieces, dt);
    handleSameTeamAvoidance(redPieces, dt);

    // Check for new battles
    battleManager.checkForBattles(
        bluePieces.filter(p => p.alive),
        redPieces.filter(p => p.alive),
        (battle) => {
            // Battle started
            if (battle.pieceA === playerPiece || battle.pieceB === playerPiece) {
                ui.notify('CONNECTION BATTLE!');
            }
        },
        (battle, winner, loser, side) => {
            // Battle ended
            ui.flashScreen();

            if (winner.team === 'blue') {
                blueScore += loser.blocks ? loser.blocks.length : 4;
                ui.notify(`Blue absorbed ${loser.shapeKey}! +${loser.mass || 4}`);
            } else {
                redScore += loser.blocks ? loser.blocks.length : 4;
                ui.notify(`Red absorbed ${loser.shapeKey}! +${loser.mass || 4}`);
            }
        }
    );

    // Update battles
    battleManager.update(dt);

    // Update battle UI
    if (playerPiece && playerPiece.inBattle) {
        const battle = battleManager.getPlayerBattle(playerPiece);
        if (battle) {
            const meters = battle.getMeterPercents();
            const isA = battle.pieceA === playerPiece;
            ui.showBattle(isA ? meters.a : meters.b, isA ? meters.b : meters.a);
        }
    } else {
        ui.hideBattle();
    }

    // Update HUD
    const aliveBlue = bluePieces.filter(p => p.alive).length;
    const aliveRed = redPieces.filter(p => p.alive).length;
    ui.updateScores(blueScore, redScore);
    ui.updatePieceCounts(aliveBlue, aliveRed);

    // Minimap
    ui.updateMinimap(
        bluePieces.filter(p => p.alive),
        redPieces.filter(p => p.alive),
        playerPiece,
        FIELD_BOUNDS
    );

    // Highlight player piece
    if (playerPiece && playerPiece.alive) {
        playerPiece.setHighlight(true);
    }

    // Check game over
    if (gameTime <= 0 || aliveBlue === 0 || aliveRed === 0) {
        endGame();
    }

    // Camera
    updateCamera();

    // Render
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

    gameRunning = true;
    gameTime = GAME_DURATION;
    blueScore = 0;
    redScore = 0;
    spawnTimer = SPAWN_INTERVAL;
    cameraAngle = 0;

    spawnInitialPieces();

    ui.hideStartScreen();
    ui.hideGameOver();
    ui.showHUD();
    ui.notify('Battle begins! Move with WASD, click to look around.');
}

function endGame() {
    gameRunning = false;
    const blueWins = blueScore >= redScore;
    ui.showGameOver(blueWins);
}

// Event listeners
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);

// Also spawn some eye-candy pieces for the title screen
function titleScreenSetup() {
    for (let i = 0; i < 3; i++) {
        const bp = spawnPiece('blue');
        bluePieces.push(bp);
        bp.speed = 1.5;
    }
    for (let i = 0; i < 3; i++) {
        const rp = spawnPiece('red');
        redPieces.push(rp);
        rp.speed = 1.5;
    }
}
titleScreenSetup();

// Start loop
gameLoop();
