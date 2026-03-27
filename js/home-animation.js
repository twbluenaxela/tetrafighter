// home-animation.js — Tutorial animation on the start screen
// Shows wireframe tetrominos colliding; loser breaks apart into blocks

const SHAPES = {
    I: [[0,0],[1,0],[2,0],[3,0]],
    T: [[0,0],[1,0],[2,0],[1,1]],
    S: [[1,0],[2,0],[0,1],[1,1]],
    Z: [[0,0],[1,0],[1,1],[2,1]],
    L: [[0,0],[0,1],[0,2],[1,2]],
    J: [[1,0],[1,1],[1,2],[0,2]],
};
const SHAPE_KEYS = Object.keys(SHAPES);
const BLOCK = 14;           // block size in px
const GAP = 2;

let canvas, ctx, animId;
let fighters = [];
let particles = [];
let time = 0;

function randomShape() {
    return SHAPE_KEYS[Math.floor(Math.random() * SHAPE_KEYS.length)];
}

function shapeCenter(blocks) {
    let cx = 0, cy = 0;
    for (const [bx, by] of blocks) { cx += bx; cy += by; }
    return [cx / blocks.length, cy / blocks.length];
}

function createFighter(team) {
    const key = randomShape();
    const blocks = SHAPES[key].map(b => [...b]);
    const center = shapeCenter(blocks);
    const color = team === 'blue' ? '#4fc3f7' : '#ef5350';
    const w = canvas.width, h = canvas.height;

    // Pick random entry direction: 0=left, 1=right, 2=top, 3=bottom
    const dir = Math.floor(Math.random() * 4);
    let x, y, vx, vy;
    const speed = 40 + Math.random() * 30; // px/s
    if (dir === 0) {        // from left
        x = -60; y = h * (0.25 + Math.random() * 0.5);
        vx = speed; vy = (Math.random() - 0.5) * 20;
    } else if (dir === 1) { // from right
        x = w + 60; y = h * (0.25 + Math.random() * 0.5);
        vx = -speed; vy = (Math.random() - 0.5) * 20;
    } else if (dir === 2) { // from top
        x = w * (0.15 + Math.random() * 0.7); y = -60;
        vx = (Math.random() - 0.5) * 20; vy = speed;
    } else {                // from bottom
        x = w * (0.15 + Math.random() * 0.7); y = h + 60;
        vx = (Math.random() - 0.5) * 20; vy = -speed;
    }

    return { blocks, center, color, team, x, y, vx, vy, alive: true, opacity: 0.7 };
}

function spawnPair() {
    fighters.push(createFighter('blue'));
    fighters.push(createFighter('red'));
}

function drawFighter(f) {
    ctx.save();
    ctx.globalAlpha = f.opacity;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 1.5;
    for (const [bx, by] of f.blocks) {
        const px = f.x + (bx - f.center[0]) * (BLOCK + GAP);
        const py = f.y + (by - f.center[1]) * (BLOCK + GAP);
        ctx.strokeRect(px - BLOCK/2, py - BLOCK/2, BLOCK, BLOCK);
    }
    ctx.restore();
}

function explode(f) {
    for (const [bx, by] of f.blocks) {
        const px = f.x + (bx - f.center[0]) * (BLOCK + GAP);
        const py = f.y + (by - f.center[1]) * (BLOCK + GAP);
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 60;
        particles.push({
            x: px, y: py,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: f.color,
            size: BLOCK,
            life: 1.0,
            decay: 0.6 + Math.random() * 0.5,
        });
    }
}

function checkCollisions() {
    for (let i = 0; i < fighters.length; i++) {
        for (let j = i + 1; j < fighters.length; j++) {
            const a = fighters[i], b = fighters[j];
            if (!a.alive || !b.alive || a.team === b.team) continue;
            const dx = a.x - b.x, dy = a.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < BLOCK * 2.5) {
                // Loser is random
                const loser = Math.random() < 0.5 ? a : b;
                explode(loser);
                loser.alive = false;
            }
        }
    }
}

function isOffScreen(f) {
    const margin = 100;
    return f.x < -margin || f.x > canvas.width + margin ||
           f.y < -margin || f.y > canvas.height + margin;
}

let spawnTimer = 0;

function update(dt) {
    time += dt;

    // Spawn new pairs periodically
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnPair();
        spawnTimer = 1.8 + Math.random() * 1.5;
    }

    // Move fighters
    for (const f of fighters) {
        if (!f.alive) continue;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
    }

    checkCollisions();

    // Remove dead or off-screen fighters
    fighters = fighters.filter(f => f.alive && !isOffScreen(f));

    // Update particles
    for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 40 * dt; // light gravity
        p.life -= p.decay * dt;
        p.size *= 0.995;
    }
    particles = particles.filter(p => p.life > 0);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const f of fighters) {
        if (f.alive) drawFighter(f);
    }

    // Draw particles
    for (const p of particles) {
        ctx.save();
        ctx.globalAlpha = p.life * 0.8;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
        ctx.restore();
    }
}

let lastTime = 0;
function loop(ts) {
    if (!canvas.parentElement || canvas.style.display === 'none') {
        animId = null;
        return;
    }
    const dt = Math.min((ts - lastTime) / 1000, 0.1);
    lastTime = ts;
    update(dt);
    draw();
    animId = requestAnimationFrame(loop);
}

function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
}

export function startHomeAnimation() {
    canvas = document.getElementById('home-anim-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    fighters = [];
    particles = [];
    spawnTimer = 0.3; // first pair spawns quickly
    lastTime = performance.now();
    if (animId) cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

export function stopHomeAnimation() {
    if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
    }
    fighters = [];
    particles = [];
}
