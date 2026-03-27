import * as THREE from 'three';
import { TetraFighter, randomShapeKey, SHAPES } from './tetromino.js';
import { checkConnection } from './battle.js';
import { AIController } from './ai.js';
import { UIManager } from './ui.js';
import { SculptureBuilder } from './sculpture.js';
import {
    initPhysics, resetWorld, createBoundaries, createFighterBody,
    removeFighterBody, rebuildColliders, setFighterVelocity,
    teleportFighter, promoteToPlayer, stepAndSync, hasBody,
} from './physics.js';
import { t, getLang, setLang, applyStaticTranslations } from './i18n.js';
import * as lobby from './lobby.js';

// Initialize Rapier WASM before anything else
await initPhysics();

// i18n: apply saved language and wire toggle
applyStaticTranslations();
const langToggle = document.getElementById('lang-toggle');
if (langToggle) {
    langToggle.addEventListener('click', () => {
        const next = getLang() === 'en' ? 'zh-TW' : 'en';
        setLang(next);
    });
}

// ============================================================
// GAME CONFIG
// ============================================================
const FIELD_WIDTH = 24;
const FIELD_LENGTH = 40;
const PIECES_PER_TEAM = 5;
const GAME_DURATION = 60;
const WIN_SCORE = 15;
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
// FLOATING BACKGROUND SHAPES
// ============================================================
const floatingShapes = [];

function createFloatingShapes() {
    const BLOCK_SIZE = 0.55;
    const shapeKeys = Object.keys(SHAPES);
    const colors = [0x4fc3f7, 0xef5350, 0x9c27b0, 0x4caf50, 0xff9800, 0x00bcd4];

    for (let i = 0; i < 20; i++) {
        const shapeDef = SHAPES[shapeKeys[Math.floor(Math.random() * shapeKeys.length)]];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const group = new THREE.Group();

        // Build wireframe blocks
        const center = { x: 0, z: 0 };
        shapeDef.blocks.forEach(([bx, , bz]) => { center.x += bx; center.z += bz; });
        center.x /= shapeDef.blocks.length;
        center.z /= shapeDef.blocks.length;

        shapeDef.blocks.forEach(([bx, , bz]) => {
            const size = BLOCK_SIZE - 0.04;
            const geo = new THREE.BoxGeometry(size, size, size);
            const edges = new THREE.EdgesGeometry(geo);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
                color, transparent: true, opacity: 0.3 + Math.random() * 0.2,
                fog: false, // ignore scene fog so they stay visible at distance
            }));
            line.position.set(
                (bx - center.x) * BLOCK_SIZE,
                0,
                (bz - center.z) * BLOCK_SIZE
            );
            group.add(line);
        });

        // Position outside the arena bounds, floating in the sky
        const side = Math.random() < 0.5 ? -1 : 1;
        const alongWall = Math.random() < 0.5;
        let px, pz;
        if (alongWall) {
            // Beyond the side walls
            px = side * (FIELD_WIDTH / 2 + 5 + Math.random() * 15);
            pz = (Math.random() - 0.5) * FIELD_LENGTH;
        } else {
            // Beyond the end walls
            px = (Math.random() - 0.5) * (FIELD_WIDTH + 20);
            pz = side * (FIELD_LENGTH / 2 + 5 + Math.random() * 10);
        }
        group.position.set(px, 4 + Math.random() * 16, pz);
        group.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
        );
        const scale = 1.5 + Math.random() * 2.5;
        group.scale.setScalar(scale);

        scene.add(group);
        floatingShapes.push({
            mesh: group,
            rotSpeed: new THREE.Vector3(
                (Math.random() - 0.5) * 0.04,
                (Math.random() - 0.5) * 0.04,
                (Math.random() - 0.5) * 0.03
            ),
            bobSpeed: 0.08 + Math.random() * 0.12,
            bobPhase: Math.random() * Math.PI * 2,
            baseY: group.position.y,
        });
    }
}
createFloatingShapes();

function updateFloatingShapes(dt) {
    for (const s of floatingShapes) {
        s.mesh.rotation.x += s.rotSpeed.x * dt;
        s.mesh.rotation.y += s.rotSpeed.y * dt;
        s.mesh.rotation.z += s.rotSpeed.z * dt;
        s.bobPhase += s.bobSpeed * dt;
        s.mesh.position.y = s.baseY + Math.sin(s.bobPhase) * 0.5;
    }
}

// ============================================================
// CONNECTION SOUND (synthesized click via Web Audio)
// ============================================================
let audioCtx = null;

function playConnectionClick() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const now = audioCtx.currentTime;

    // Layer 1: sharp snap click (high-freq burst)
    const clickOsc = audioCtx.createOscillator();
    const clickGain = audioCtx.createGain();
    clickOsc.connect(clickGain);
    clickGain.connect(audioCtx.destination);
    clickOsc.type = 'square';
    clickOsc.frequency.setValueAtTime(1800, now);
    clickOsc.frequency.exponentialRampToValueAtTime(600, now + 0.015);
    clickGain.gain.setValueAtTime(0.35, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    clickOsc.start(now);
    clickOsc.stop(now + 0.03);

    // Layer 2: low thud (lego block seating)
    const thudOsc = audioCtx.createOscillator();
    const thudGain = audioCtx.createGain();
    thudOsc.connect(thudGain);
    thudGain.connect(audioCtx.destination);
    thudOsc.type = 'sine';
    thudOsc.frequency.setValueAtTime(180, now + 0.005);
    thudOsc.frequency.exponentialRampToValueAtTime(60, now + 0.08);
    thudGain.gain.setValueAtTime(0.0001, now);
    thudGain.gain.linearRampToValueAtTime(0.25, now + 0.008);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    thudOsc.start(now + 0.005);
    thudOsc.stop(now + 0.1);

    // Layer 3: noise burst for plastic texture
    const bufferSize = audioCtx.sampleRate * 0.02;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
    const noiseSrc = audioCtx.createBufferSource();
    const noiseGain = audioCtx.createGain();
    noiseSrc.buffer = noiseBuffer;
    noiseSrc.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
    noiseSrc.start(now);
    noiseSrc.stop(now + 0.025);
}

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
    const yAngle = fighter.direction === -1 ? Math.PI : 0;
    fighter.desiredFacing = yAngle;
    fighter.group.rotation.y = yAngle;
    // Teleport Rapier body to match
    teleportFighter(fighter, x, z, yAngle);
}

function spawnReinforcements() {
    if (bluePieces.filter(p => p.alive).length < MAX_PIECES) {
        const bp = spawnPiece('blue');
        bluePieces.push(bp);
        createFighterBody(bp);
        ui.notify(t('blueReinforcement'));
    }
    if (redPieces.filter(p => p.alive).length < MAX_PIECES) {
        const rp = spawnPiece('red');
        redPieces.push(rp);
        createFighterBody(rp);
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
        cameraAngle -= e.movementX * 0.003;
    }
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
// MOBILE TOUCH CONTROLS
// ============================================================
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const mobileControls = document.getElementById('mobile-controls');
const joystickZone = document.getElementById('joystick-zone');
const joystickKnob = document.getElementById('joystick-knob');
const btnRotateCCW = document.getElementById('btn-rotate-ccw');
const btnRotateCW = document.getElementById('btn-rotate-cw');
const btnSprint = document.getElementById('btn-sprint');

// Joystick state
let joystickActive = false;
let joystickTouchId = null;
let joystickX = 0; // -1 to 1
let joystickY = 0; // -1 to 1
const JOYSTICK_RADIUS = 45; // max knob travel from center

// Camera swipe state (touches not on controls)
let cameraTouchId = null;
let cameraTouchLastX = 0;

// Sprint toggle
let mobileSprint = false;

if (isMobile) {
    mobileControls.style.display = 'block';

    // Prevent default touch behaviors on the whole page
    document.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });

    // --- JOYSTICK ---
    joystickZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (joystickTouchId !== null) return;
        const touch = e.changedTouches[0];
        joystickTouchId = touch.identifier;
        updateJoystick(touch);
    });

    joystickZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touch.identifier === joystickTouchId) {
                updateJoystick(touch);
            }
        }
    });

    const endJoystick = (e) => {
        for (const touch of e.changedTouches) {
            if (touch.identifier === joystickTouchId) {
                joystickTouchId = null;
                joystickX = 0;
                joystickY = 0;
                joystickKnob.style.transform = 'translate(0px, 0px)';
            }
        }
    };
    joystickZone.addEventListener('touchend', endJoystick);
    joystickZone.addEventListener('touchcancel', endJoystick);

    function updateJoystick(touch) {
        const rect = joystickZone.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = touch.clientX - cx;
        let dy = touch.clientY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > JOYSTICK_RADIUS) {
            dx = dx / dist * JOYSTICK_RADIUS;
            dy = dy / dist * JOYSTICK_RADIUS;
        }
        joystickX = dx / JOYSTICK_RADIUS; // -1 to 1
        joystickY = dy / JOYSTICK_RADIUS; // -1 to 1 (positive = down on screen)
        joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    }

    // --- ROTATE BUTTONS ---
    btnRotateCCW.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (gameRunning && playerPiece && playerPiece.alive) {
            playerPiece.rotateBody(-1);
        }
    });
    btnRotateCW.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (gameRunning && playerPiece && playerPiece.alive) {
            playerPiece.rotateBody(1);
        }
    });

    // --- SPRINT TOGGLE ---
    btnSprint.addEventListener('touchstart', (e) => {
        e.preventDefault();
        mobileSprint = !mobileSprint;
        btnSprint.classList.toggle('active', mobileSprint);
    });

    // --- CAMERA SWIPE (any touch on the canvas / right side) ---
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (cameraTouchId !== null) return;
        const touch = e.changedTouches[0];
        cameraTouchId = touch.identifier;
        cameraTouchLastX = touch.clientX;
    });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touch.identifier === cameraTouchId) {
                const dx = touch.clientX - cameraTouchLastX;
                cameraAngle -= dx * 0.005;
                cameraTouchLastX = touch.clientX;
            }
        }
    });

    const endCamera = (e) => {
        for (const touch of e.changedTouches) {
            if (touch.identifier === cameraTouchId) {
                cameraTouchId = null;
            }
        }
    };
    canvas.addEventListener('touchend', endCamera);
    canvas.addEventListener('touchcancel', endCamera);

    // Update controls hint for mobile
    const controlsHint = document.getElementById('start-controls');
    if (controlsHint) {
        controlsHint.innerHTML =
            '<span data-i18n="controlsMobile">' + t('controlsMobile') + '</span><br>' +
            '<span class="hint-flavor" data-i18n="controlsHint">' + t('controlsHint') + '</span>';
    }
}

// ============================================================
// PLAYER MOVEMENT
// ============================================================
const WALK_SPEED = 2.5;
const SPRINT_SPEED = 5.5;

// Derive movement directions from what the camera actually sees.
// This guarantees W=into screen, A=screen-left regardless of angle math.
function getScreenForward() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();
    return dir;
}
function getScreenRight() {
    const fwd = getScreenForward();
    // 90° clockwise in XZ plane
    return new THREE.Vector3(-fwd.z, 0, fwd.x);
}

function handlePlayerMovement(dt) {
    if (!playerPiece || !playerPiece.alive) return;

    const moveDir = new THREE.Vector3();
    const forward = getScreenForward();
    const right = getScreenRight();

    // Keyboard input
    if (keys['KeyW']) moveDir.add(forward);
    if (keys['KeyS']) moveDir.sub(forward);
    if (keys['KeyA']) moveDir.sub(right);
    if (keys['KeyD']) moveDir.add(right);

    // Mobile joystick input (joystickY is inverted: screen-down = +Y but forward = -screen)
    if (isMobile && (Math.abs(joystickX) > 0.1 || Math.abs(joystickY) > 0.1)) {
        moveDir.add(right.clone().multiplyScalar(joystickX));
        moveDir.sub(forward.clone().multiplyScalar(joystickY));
    }

    const isSprinting = keys['ShiftLeft'] || keys['ShiftRight'] || mobileSprint;
    const speed = isSprinting ? SPRINT_SPEED : WALK_SPEED;

    if (moveDir.length() > 0) {
        moveDir.normalize();
        const vx = moveDir.x * speed;
        const vz = moveDir.z * speed;

        // Track velocity for collision momentum checks
        playerPiece.velocity.set(vx, 0, vz);

        // Set Rapier velocity (physics handles position + wall clamping)
        setFighterVelocity(playerPiece, vx, vz);

        // Fallback for title screen (no Rapier body)
        if (!hasBody(playerPiece)) {
            playerPiece.position.x += vx * dt;
            playerPiece.position.z += vz * dt;
            playerPiece.position.x = THREE.MathUtils.clamp(
                playerPiece.position.x, FIELD_BOUNDS.minX + 1, FIELD_BOUNDS.maxX - 1
            );
            playerPiece.position.z = THREE.MathUtils.clamp(
                playerPiece.position.z, FIELD_BOUNDS.minZ, FIELD_BOUNDS.maxZ
            );
        }

        // Face movement direction
        const angle = Math.atan2(moveDir.x, moveDir.z);
        playerPiece.desiredFacing = angle;
        playerPiece.group.rotation.y = angle; // fallback for non-physics

        // Animation flags
        playerPiece.isRunning = true;
        playerPiece.isSprinting = isSprinting;
    } else {
        playerPiece.isRunning = false;
        playerPiece.isSprinting = false;
        playerPiece.velocity.set(0, 0, 0);
        setFighterVelocity(playerPiece, 0, 0);
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

    // Camera orbit uses cameraAngle directly for positioning
    const idealPos = new THREE.Vector3(
        pp.x - Math.sin(cameraAngle) * cameraDistance,
        pp.y + cameraHeight,
        pp.z - Math.cos(cameraAngle) * cameraDistance
    );

    // Responsive follow
    camera.position.lerp(idealPos, 0.5);

    // Look at the player (slightly above center)
    const lookTarget = new THREE.Vector3(pp.x, pp.y + 1.5, pp.z);
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
// HITBOX COLLISION
// ============================================================
const COLLISION_RADIUS = 2.5;
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
    playConnectionClick();

    const shapeData = loser.getShapeData();
    sculptureBuilder.addShape(winner.team, shapeData);

    if (winner.team === 'blue') {
        blueScore++;
    } else {
        redScore++;
    }

    removeFighterBody(loser);
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

    updateFloatingShapes(dt);

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
            promoteToPlayer(playerPiece);
            ui.notify(t('switchedFighter'));
        } else {
            playerPiece = null;
        }
    }

    // AI
    const blueAIPieces = bluePieces.filter(p => p.alive && p !== playerPiece);
    blueAI.update(dt, blueAIPieces, redPieces.filter(p => p.alive));
    redAI.update(dt, redPieces.filter(p => p.alive), bluePieces.filter(p => p.alive));

    // Update all fighters (AI movement + animation)
    [...bluePieces, ...redPieces].forEach(p => p.update(dt, FIELD_BOUNDS));

    // Apply AI velocities to Rapier + handle rotation rebuilds
    [...bluePieces, ...redPieces].forEach(p => {
        if (!p.alive || !hasBody(p)) return;
        if (!p.isPlayerControlled) {
            setFighterVelocity(p, p.velocity.x, p.velocity.z);
        }
        if (p.justRotated) {
            rebuildColliders(p);
            p.justRotated = false;
        }
    });

    // Rapier physics step — colliders sweep during rotation, solver handles all push forces
    stepAndSync(dt);

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

    // Check game over — first to WIN_SCORE, time runs out, or team eliminated
    const blueArtNow = sculptureBuilder.getShapeCount('blue');
    const redArtNow = sculptureBuilder.getShapeCount('red');
    if (gameTime <= 0 || aliveBlue === 0 || aliveRed === 0 || blueArtNow >= WIN_SCORE || redArtNow >= WIN_SCORE) {
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

    // Reset physics world and create boundaries
    resetWorld();
    createBoundaries(FIELD_BOUNDS);

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

    // Create Rapier bodies for all fighters
    [...bluePieces, ...redPieces].forEach(p => {
        createFighterBody(p, p === playerPiece);
    });

    // Hide all menu screens
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('room-screen').style.display = 'none';
    ui.hideGameOver();
    ui.showHUD();
    ui.notify(t('battleBegins'));

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

// Game mode state
let gameMode = 'pve'; // 'pve' | 'pvp'
let pvpRoomData = null;

function handleGameStart(opts) {
    gameMode = opts.mode;
    pvpRoomData = opts.room || null;

    // Hide all menu screens
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('room-screen').style.display = 'none';

    startGame();
}

// Initialize lobby system
lobby.init(handleGameStart);

// Restart button still works
document.getElementById('restart-btn').addEventListener('click', () => handleGameStart({ mode: gameMode }));

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
