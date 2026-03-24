import * as THREE from 'three';

/**
 * Battle System — Tetris-style connection battles.
 *
 * When two fighters meet, they square off. Each can:
 *   Q/E — rotate their tetromino body 90°
 *   SPACE — lunge forward toward the opponent
 *
 * On lunge, we check if the two shapes "connect" (fit together like Tetris
 * pieces: edge-adjacent blocks, no overlaps). First to connect wins.
 * If the lunge doesn't connect, the attacker bounces back.
 */

const BATTLE_DISTANCE = 2.8;
const BATTLE_SEPARATION = 4.0;      // How far apart fighters stand
const LUNGE_SPEED = 14;             // Units/sec during lunge
const LUNGE_DURATION = 0.28;        // Seconds the lunge lasts
const LUNGE_COOLDOWN = 0.8;         // Seconds before you can lunge again
const BOUNCE_SPEED = 8;             // Speed of bounce-back on miss
const BATTLE_TIMEOUT = 10;          // Seconds before auto-resolve
const CONNECTION_GRID = 0.5;        // Grid cell size for connection check

const AI_ROTATE_INTERVAL_MIN = 0.6;
const AI_ROTATE_INTERVAL_MAX = 1.5;
const AI_LUNGE_INTERVAL_MIN = 1.2;
const AI_LUNGE_INTERVAL_MAX = 2.5;

/**
 * Check if two sets of grid-snapped blocks form a valid Tetris connection.
 * A connection requires:
 *   1. At least one pair of blocks is edge-adjacent (Manhattan distance = 1 grid cell)
 *   2. No blocks overlap
 * Returns { connected: bool, adjacentCount: number }
 */
function checkConnection(blocksA, blocksB) {
    const gridSize = CONNECTION_GRID;

    // Build a set of occupied positions for B
    const bSet = new Set();
    blocksB.forEach(([x, z]) => {
        bSet.add(`${Math.round(x / gridSize)},${Math.round(z / gridSize)}`);
    });

    let adjacentCount = 0;
    let overlaps = 0;

    for (const [ax, az] of blocksA) {
        const gx = Math.round(ax / gridSize);
        const gz = Math.round(az / gridSize);

        // Check overlap
        if (bSet.has(`${gx},${gz}`)) {
            overlaps++;
        }

        // Check 4 edge-adjacent neighbors
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            if (bSet.has(`${gx + dx},${gz + dz}`)) {
                adjacentCount++;
            }
        }
    }

    return {
        connected: adjacentCount > 0 && overlaps === 0,
        adjacentCount,
        overlaps,
    };
}

export class Battle {
    constructor(pieceA, pieceB, onComplete) {
        this.pieceA = pieceA;
        this.pieceB = pieceB;
        this.onComplete = onComplete;

        this.timeElapsed = 0;
        this.resolved = false;

        // Lock pieces into battle
        pieceA.inBattle = true;
        pieceA.battleTarget = pieceB;
        pieceB.inBattle = true;
        pieceB.battleTarget = pieceA;

        // Position fighters facing each other with separation
        const midpoint = new THREE.Vector3()
            .addVectors(pieceA.position, pieceB.position)
            .multiplyScalar(0.5);
        const dir = new THREE.Vector3()
            .subVectors(pieceB.position, pieceA.position)
            .normalize();

        pieceA.position.copy(midpoint).addScaledVector(dir, -BATTLE_SEPARATION / 2);
        pieceB.position.copy(midpoint).addScaledVector(dir, BATTLE_SEPARATION / 2);

        pieceA.velocity.set(0, 0, 0);
        pieceB.velocity.set(0, 0, 0);
        pieceA.lungeCooldown = 0.5; // Brief initial cooldown
        pieceB.lungeCooldown = 0.5;
        pieceA.isLunging = false;
        pieceB.isLunging = false;

        // Face each other
        const angleAtoB = Math.atan2(dir.x, dir.z);
        pieceA.group.rotation.y = angleAtoB;
        pieceB.group.rotation.y = angleAtoB + Math.PI;

        // Store battle positions for bounce-back
        this.posA = pieceA.position.clone();
        this.posB = pieceB.position.clone();
        this.battleDir = dir.clone(); // direction from A toward B

        // Lunge tracking
        this.lungeA = null; // { startTime, startPos }
        this.lungeB = null;

        // AI behavior
        this.aiRotateTimer = 0;
        this.aiNextRotate = this._randomInterval(AI_ROTATE_INTERVAL_MIN, AI_ROTATE_INTERVAL_MAX);
        this.aiLungeTimer = 0;
        this.aiNextLunge = this._randomInterval(AI_LUNGE_INTERVAL_MIN, AI_LUNGE_INTERVAL_MAX);

        // Track near-misses for timeout resolution
        this.lungeAttemptsA = 0;
        this.lungeAttemptsB = 0;
        this.bestAdjacencyA = 0;
        this.bestAdjacencyB = 0;
    }

    _randomInterval(min, max) {
        return min + Math.random() * (max - min);
    }

    // Player actions
    playerRotate(dir) {
        if (this.resolved) return;
        this.pieceA.rotateBody(dir);
    }

    playerLunge() {
        if (this.resolved || this.pieceA.lungeCooldown > 0 || this.pieceA.isLunging) return;
        this._startLunge('a');
    }

    // AI actions
    aiRotate(dir) {
        if (this.resolved) return;
        this.pieceB.rotateBody(dir);
    }

    aiLunge() {
        if (this.resolved || this.pieceB.lungeCooldown > 0 || this.pieceB.isLunging) return;
        this._startLunge('b');
    }

    _startLunge(side) {
        const piece = side === 'a' ? this.pieceA : this.pieceB;
        const target = side === 'a' ? this.pieceB : this.pieceA;

        piece.isLunging = true;

        // Lunge velocity toward the opponent
        const dir = new THREE.Vector3()
            .subVectors(target.position, piece.position)
            .normalize();
        piece.velocity.copy(dir.multiplyScalar(LUNGE_SPEED));

        if (side === 'a') {
            this.lungeA = { startTime: this.timeElapsed, startPos: piece.position.clone() };
            this.lungeAttemptsA++;
        } else {
            this.lungeB = { startTime: this.timeElapsed, startPos: piece.position.clone() };
            this.lungeAttemptsB++;
        }
    }

    _endLunge(side, connected) {
        const piece = side === 'a' ? this.pieceA : this.pieceB;

        piece.isLunging = false;
        piece.lungeCooldown = LUNGE_COOLDOWN;

        if (!connected) {
            // Bounce back to starting position
            const startPos = side === 'a' ? this.posA : this.posB;
            const bounceDir = new THREE.Vector3()
                .subVectors(startPos, piece.position)
                .normalize();
            piece.velocity.copy(bounceDir.multiplyScalar(BOUNCE_SPEED));
        }

        if (side === 'a') this.lungeA = null;
        else this.lungeB = null;
    }

    update(dt) {
        if (this.resolved) return;

        this.timeElapsed += dt;

        // Check active lunges
        this._updateLunge('a', dt);
        this._updateLunge('b', dt);

        // AI behavior (for pieceB / non-player side)
        this._updateAI(dt);

        // Timeout
        if (this.timeElapsed > BATTLE_TIMEOUT) {
            // Whoever had better adjacency in their attempts wins
            // (closer to connecting = more skillful)
            if (this.bestAdjacencyA >= this.bestAdjacencyB) {
                this._resolve('a');
            } else {
                this._resolve('b');
            }
        }
    }

    _updateLunge(side, dt) {
        const lunge = side === 'a' ? this.lungeA : this.lungeB;
        if (!lunge) return;

        const piece = side === 'a' ? this.pieceA : this.pieceB;
        const other = side === 'a' ? this.pieceB : this.pieceA;

        const elapsed = this.timeElapsed - lunge.startTime;

        if (elapsed >= LUNGE_DURATION) {
            // Lunge finished — check connection
            const blocksAttacker = piece.getWorldBlocks();
            const blocksDefender = other.getWorldBlocks();
            const result = checkConnection(blocksAttacker, blocksDefender);

            // Track best adjacency for timeout resolution
            if (side === 'a') {
                this.bestAdjacencyA = Math.max(this.bestAdjacencyA, result.adjacentCount);
            } else {
                this.bestAdjacencyB = Math.max(this.bestAdjacencyB, result.adjacentCount);
            }

            if (result.connected) {
                // Connection! Attacker wins
                this._resolve(side);
                return;
            }

            // Miss — bounce back
            piece.velocity.set(0, 0, 0);
            this._endLunge(side, false);
        }
    }

    _updateAI(dt) {
        if (this.resolved) return;

        // Rotate periodically
        this.aiRotateTimer += dt;
        if (this.aiRotateTimer >= this.aiNextRotate) {
            this.aiRotateTimer = 0;
            this.aiNextRotate = this._randomInterval(AI_ROTATE_INTERVAL_MIN, AI_ROTATE_INTERVAL_MAX);
            this.aiRotate(Math.random() < 0.5 ? 1 : -1);
        }

        // Lunge periodically
        this.aiLungeTimer += dt;
        if (this.aiLungeTimer >= this.aiNextLunge) {
            this.aiLungeTimer = 0;
            this.aiNextLunge = this._randomInterval(AI_LUNGE_INTERVAL_MIN, AI_LUNGE_INTERVAL_MAX);
            this.aiLunge();
        }
    }

    _resolve(winner) {
        if (this.resolved) return;
        this.resolved = true;

        const winnerPiece = winner === 'a' ? this.pieceA : this.pieceB;
        const loserPiece = winner === 'a' ? this.pieceB : this.pieceA;

        winnerPiece.inBattle = false;
        winnerPiece.battleTarget = null;
        winnerPiece.isLunging = false;
        winnerPiece.velocity.set(0, 0, 0);

        this.onComplete(winnerPiece, loserPiece, loserPiece.getShapeData(), winner);
    }

    /** For UI — show lunge cooldown / status */
    getStatus() {
        return {
            cooldownA: this.pieceA.lungeCooldown,
            cooldownB: this.pieceB.lungeCooldown,
            isLungingA: this.pieceA.isLunging,
            isLungingB: this.pieceB.isLunging,
            timeLeft: Math.max(0, BATTLE_TIMEOUT - this.timeElapsed),
        };
    }
}

export class BattleManager {
    constructor() {
        this.activeBattles = [];
    }

    checkForBattles(bluePieces, redPieces, onBattleStart, onBattleEnd) {
        for (const bp of bluePieces) {
            if (!bp.alive || bp.inBattle) continue;
            for (const rp of redPieces) {
                if (!rp.alive || rp.inBattle) continue;

                const dist = bp.position.distanceTo(rp.position);
                if (dist < BATTLE_DISTANCE) {
                    const battle = new Battle(bp, rp, (winner, loser, shapeData, side) => {
                        this.activeBattles = this.activeBattles.filter(b => b !== battle);
                        onBattleEnd(battle, winner, loser, shapeData, side);
                    });
                    this.activeBattles.push(battle);
                    onBattleStart(battle);
                    return;
                }
            }
        }
    }

    update(dt) {
        this.activeBattles.forEach(b => b.update(dt));
    }

    getPlayerBattle(playerPiece) {
        return this.activeBattles.find(
            b => b.pieceA === playerPiece || b.pieceB === playerPiece
        ) || null;
    }

    get hasBattles() {
        return this.activeBattles.length > 0;
    }
}
