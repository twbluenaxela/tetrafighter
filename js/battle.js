import * as THREE from 'three';

/**
 * Real-Time Battle System — Tetris-style connection battles.
 *
 * When two fighters get close, a battle begins. Both fighters keep moving
 * freely in the world. Controls during battle:
 *   Q/E — rotate tetromino body 90°
 *   SPACE — lunge (speed burst) toward opponent
 *   WASD — normal movement still works
 *
 * During a lunge, if the attacker gets close enough, we check if the two
 * shapes "connect" (fit together like Tetris pieces: edge-adjacent, no
 * overlaps). First to connect wins.
 */

const BATTLE_DISTANCE = 2.8;
const LUNGE_SPEED = 16;
const LUNGE_DURATION = 0.22;
const LUNGE_COOLDOWN = 0.8;
const BATTLE_TIMEOUT = 15;
const CONNECTION_CHECK_DISTANCE = 2.0;
const CONNECTION_GRID = 0.5;

// AI behavior
const AI_ROTATE_MIN = 0.6;
const AI_ROTATE_MAX = 1.5;
const AI_LUNGE_MIN = 1.2;
const AI_LUNGE_MAX = 2.5;
const AI_STRAFE_SPEED = 3.0;
const AI_PREFERRED_DIST = 3.5;
const AI_STRAFE_CHANGE_MIN = 1.0;
const AI_STRAFE_CHANGE_MAX = 3.0;

/**
 * Check if two sets of grid-snapped blocks form a valid Tetris connection.
 * Returns { connected, adjacentCount, overlaps }
 */
function checkConnection(blocksA, blocksB) {
    const g = CONNECTION_GRID;
    const bSet = new Set();
    blocksB.forEach(([x, z]) => {
        bSet.add(`${Math.round(x / g)},${Math.round(z / g)}`);
    });

    let adjacentCount = 0;
    let overlaps = 0;

    for (const [ax, az] of blocksA) {
        const gx = Math.round(ax / g);
        const gz = Math.round(az / g);

        if (bSet.has(`${gx},${gz}`)) overlaps++;

        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            if (bSet.has(`${gx + dx},${gz + dz}`)) adjacentCount++;
        }
    }

    return { connected: adjacentCount > 0 && overlaps === 0, adjacentCount, overlaps };
}

export class Battle {
    constructor(pieceA, pieceB, onComplete) {
        this.pieceA = pieceA;
        this.pieceB = pieceB;
        this.onComplete = onComplete;

        this.timeElapsed = 0;
        this.resolved = false;

        // Mark pieces as in battle — but DON'T reposition them
        pieceA.inBattle = true;
        pieceA.battleTarget = pieceB;
        pieceB.inBattle = true;
        pieceB.battleTarget = pieceA;

        // Don't zero velocity — let them keep momentum
        pieceA.lungeCooldown = 0.5;
        pieceB.lungeCooldown = 0.5;
        pieceA.isLunging = false;
        pieceB.isLunging = false;
        pieceA.lungeVelocity = null;
        pieceB.lungeVelocity = null;

        // AI circle-strafe state
        this.aiStrafeDir = Math.random() < 0.5 ? 1 : -1;
        this.aiStrafeTimer = 0;
        this.aiNextStrafeChange = this._rand(AI_STRAFE_CHANGE_MIN, AI_STRAFE_CHANGE_MAX);

        // AI rotate/lunge timers
        this.aiRotateTimer = 0;
        this.aiNextRotate = this._rand(AI_ROTATE_MIN, AI_ROTATE_MAX);
        this.aiLungeTimer = 0;
        this.aiNextLunge = this._rand(AI_LUNGE_MIN, AI_LUNGE_MAX);

        // Tracking for timeout resolution
        this.bestAdjacencyA = 0;
        this.bestAdjacencyB = 0;
    }

    _rand(min, max) {
        return min + Math.random() * (max - min);
    }

    // --- Player actions ---

    playerRotate(dir) {
        if (this.resolved) return;
        this.pieceA.rotateBody(dir);
    }

    playerLunge() {
        if (this.resolved || this.pieceA.lungeCooldown > 0 || this.pieceA.isLunging) return;
        this._startLunge(this.pieceA, this.pieceB);
    }

    // --- Core lunge mechanic ---

    _startLunge(piece, target) {
        const dir = new THREE.Vector3()
            .subVectors(target.position, piece.position)
            .normalize();

        piece.isLunging = true;
        piece.lungeVelocity = dir.clone().multiplyScalar(LUNGE_SPEED);
        piece.lungeTimeRemaining = LUNGE_DURATION;
        piece.lungeCooldown = 0; // Set on end
    }

    _updatePieceLunge(piece, other, side, dt) {
        if (!piece.isLunging || !piece.lungeVelocity) return;

        // Apply lunge velocity
        piece.position.x += piece.lungeVelocity.x * dt;
        piece.position.z += piece.lungeVelocity.z * dt;

        piece.lungeTimeRemaining -= dt;

        // Check connection if close enough
        const dist = piece.position.distanceTo(other.position);
        if (dist < CONNECTION_CHECK_DISTANCE) {
            const blocksA = piece.getWorldBlocks();
            const blocksB = other.getWorldBlocks();
            const result = checkConnection(blocksA, blocksB);

            if (side === 'a') this.bestAdjacencyA = Math.max(this.bestAdjacencyA, result.adjacentCount);
            else this.bestAdjacencyB = Math.max(this.bestAdjacencyB, result.adjacentCount);

            if (result.connected) {
                this._resolve(side);
                return;
            }
        }

        // Lunge expired — miss
        if (piece.lungeTimeRemaining <= 0) {
            piece.isLunging = false;
            piece.lungeVelocity = null;
            piece.lungeCooldown = LUNGE_COOLDOWN;
        }
    }

    // --- AI behavior ---

    _updateAI(dt) {
        if (this.resolved) return;

        const ai = this.pieceB;
        const target = this.pieceA;

        // Circle-strafe around the player
        const toTarget = new THREE.Vector3()
            .subVectors(target.position, ai.position);
        const dist = toTarget.length();
        toTarget.normalize();

        // Strafe perpendicular to opponent direction
        const strafe = new THREE.Vector3(-toTarget.z, 0, toTarget.x)
            .multiplyScalar(this.aiStrafeDir * AI_STRAFE_SPEED);

        // Approach/retreat to maintain preferred distance
        const approach = toTarget.clone().multiplyScalar(
            (dist - AI_PREFERRED_DIST) * 2.0
        );

        // Combined AI movement
        const aiMove = strafe.add(approach);
        ai.position.x += aiMove.x * dt;
        ai.position.z += aiMove.z * dt;

        // Face the opponent
        const faceAngle = Math.atan2(toTarget.x, toTarget.z);
        ai.group.rotation.y = faceAngle;

        // Periodically change strafe direction
        this.aiStrafeTimer += dt;
        if (this.aiStrafeTimer >= this.aiNextStrafeChange) {
            this.aiStrafeTimer = 0;
            this.aiNextStrafeChange = this._rand(AI_STRAFE_CHANGE_MIN, AI_STRAFE_CHANGE_MAX);
            this.aiStrafeDir *= -1;
        }

        // Periodically rotate body
        this.aiRotateTimer += dt;
        if (this.aiRotateTimer >= this.aiNextRotate) {
            this.aiRotateTimer = 0;
            this.aiNextRotate = this._rand(AI_ROTATE_MIN, AI_ROTATE_MAX);
            ai.rotateBody(Math.random() < 0.5 ? 1 : -1);
        }

        // Periodically lunge
        ai.lungeCooldown = Math.max(0, ai.lungeCooldown - dt);
        this.aiLungeTimer += dt;
        if (this.aiLungeTimer >= this.aiNextLunge && ai.lungeCooldown <= 0 && !ai.isLunging) {
            this.aiLungeTimer = 0;
            this.aiNextLunge = this._rand(AI_LUNGE_MIN, AI_LUNGE_MAX);
            if (dist < 6) {
                this._startLunge(ai, target);
            }
        }
    }

    // --- Main update ---

    update(dt) {
        if (this.resolved) return;

        this.timeElapsed += dt;

        // Update cooldowns
        this.pieceA.lungeCooldown = Math.max(0, this.pieceA.lungeCooldown - dt);

        // Update lunges
        this._updatePieceLunge(this.pieceA, this.pieceB, 'a', dt);
        this._updatePieceLunge(this.pieceB, this.pieceA, 'b', dt);

        // AI behavior
        this._updateAI(dt);

        // Face opponent (player side) — smooth rotation toward target
        if (this.pieceA.inBattle && this.pieceB.alive) {
            const toEnemy = new THREE.Vector3()
                .subVectors(this.pieceB.position, this.pieceA.position).normalize();
            const targetAngle = Math.atan2(toEnemy.x, toEnemy.z);
            // Smooth rotation
            let diff = targetAngle - this.pieceA.group.rotation.y;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            this.pieceA.group.rotation.y += diff * 0.1;
        }

        // Timeout
        if (this.timeElapsed > BATTLE_TIMEOUT) {
            if (this.bestAdjacencyA >= this.bestAdjacencyB) {
                this._resolve('a');
            } else {
                this._resolve('b');
            }
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
        winnerPiece.lungeVelocity = null;
        winnerPiece.velocity.set(0, 0, 0);

        this.onComplete(winnerPiece, loserPiece, loserPiece.getShapeData(), winner);
    }

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
