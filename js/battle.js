import * as THREE from 'three';

/**
 * BattleSystem handles the repel/attract connection battles between pieces.
 * When two opposing pieces get close, a battle begins.
 * Players mash attract (SPACE) to pull in and repel (SHIFT) to push away.
 * The side with higher "connection meter" wins and absorbs the opponent.
 */

const BATTLE_DISTANCE = 2.5;       // Distance to trigger battle
const BATTLE_WIN_THRESHOLD = 100;  // Meter needed to win
const ATTRACT_POWER = 8;           // Per press
const REPEL_POWER = 12;            // Per press - slightly stronger but has cooldown
const DECAY_RATE = 15;             // Passive meter decay per second
const AI_PRESS_INTERVAL_MIN = 0.12;
const AI_PRESS_INTERVAL_MAX = 0.25;
const BATTLE_TIMEOUT = 8;          // Seconds before battle auto-resolves

export class Battle {
    constructor(pieceA, pieceB, onComplete) {
        this.pieceA = pieceA; // Usually player's piece or blue team
        this.pieceB = pieceB; // Usually AI/red team
        this.onComplete = onComplete;

        this.meterA = 50; // 0-100, starts at midpoint
        this.meterB = 50;
        this.timeElapsed = 0;
        this.resolved = false;

        // Lock pieces into battle
        pieceA.inBattle = true;
        pieceA.battleTarget = pieceB;
        pieceB.inBattle = true;
        pieceB.battleTarget = pieceA;

        // Position pieces facing each other
        const midpoint = new THREE.Vector3().addVectors(pieceA.position, pieceB.position).multiplyScalar(0.5);
        const separation = 3.0;
        const dir = new THREE.Vector3().subVectors(pieceB.position, pieceA.position).normalize();

        pieceA.velocity.set(0, 0, 0);
        pieceB.velocity.set(0, 0, 0);

        // AI behavior for pieceB
        this.aiNextPress = this._randomAiInterval();
        this.aiTimer = 0;
        this.aiStrategy = Math.random(); // Determines AI aggressiveness
    }

    _randomAiInterval() {
        return AI_PRESS_INTERVAL_MIN + Math.random() * (AI_PRESS_INTERVAL_MAX - AI_PRESS_INTERVAL_MIN);
    }

    playerAttract() {
        if (this.resolved) return;
        this.meterA += ATTRACT_POWER;
        this.meterB -= ATTRACT_POWER * 0.4;
        // Pull pieces together slightly
        this.pieceA.applyAttract(this.pieceB.position);
    }

    playerRepel() {
        if (this.resolved) return;
        this.meterB -= REPEL_POWER;
        // Push enemy away
        this.pieceB.applyRepel(this.pieceA.position);
    }

    aiAttract() {
        if (this.resolved) return;
        this.meterB += ATTRACT_POWER;
        this.meterA -= ATTRACT_POWER * 0.4;
        this.pieceB.applyAttract(this.pieceA.position);
    }

    aiRepel() {
        if (this.resolved) return;
        this.meterA -= REPEL_POWER;
        this.pieceA.applyRepel(this.pieceB.position);
    }

    update(dt) {
        if (this.resolved) return;

        this.timeElapsed += dt;

        // Decay both meters toward 50 (neutral)
        if (this.meterA > 50) this.meterA -= DECAY_RATE * dt;
        if (this.meterA < 50) this.meterA += DECAY_RATE * dt * 0.5;
        if (this.meterB > 50) this.meterB -= DECAY_RATE * dt;
        if (this.meterB < 50) this.meterB += DECAY_RATE * dt * 0.5;

        // Clamp
        this.meterA = Math.max(0, Math.min(BATTLE_WIN_THRESHOLD, this.meterA));
        this.meterB = Math.max(0, Math.min(BATTLE_WIN_THRESHOLD, this.meterB));

        // AI input simulation
        this.aiTimer += dt;
        if (this.aiTimer >= this.aiNextPress) {
            this.aiTimer = 0;
            this.aiNextPress = this._randomAiInterval();

            // AI strategy: mix of attract and repel
            if (this.meterA > 70) {
                // Player is winning — AI repels more
                if (Math.random() < 0.7) this.aiRepel();
                else this.aiAttract();
            } else if (this.meterB < 30) {
                // AI is losing — attract aggressively
                this.aiAttract();
            } else {
                // Normal play
                if (Math.random() < 0.5 + this.aiStrategy * 0.2) {
                    this.aiAttract();
                } else {
                    this.aiRepel();
                }
            }
        }

        // Check win conditions
        if (this.meterA >= BATTLE_WIN_THRESHOLD) {
            this._resolve('a');
        } else if (this.meterB >= BATTLE_WIN_THRESHOLD) {
            this._resolve('b');
        } else if (this.timeElapsed > BATTLE_TIMEOUT) {
            // Timeout: whoever has higher meter wins
            this._resolve(this.meterA >= this.meterB ? 'a' : 'b');
        }
    }

    _resolve(winner) {
        if (this.resolved) return;
        this.resolved = true;

        const winnerPiece = winner === 'a' ? this.pieceA : this.pieceB;
        const loserPiece = winner === 'a' ? this.pieceB : this.pieceA;

        // Winner absorbs loser
        winnerPiece.absorb(loserPiece);
        winnerPiece.inBattle = false;
        winnerPiece.battleTarget = null;

        this.onComplete(winnerPiece, loserPiece, winner);
    }

    getMeterPercents() {
        return {
            a: this.meterA / BATTLE_WIN_THRESHOLD * 100,
            b: this.meterB / BATTLE_WIN_THRESHOLD * 100,
        };
    }
}

export class BattleManager {
    constructor() {
        this.activeBattles = [];
    }

    checkForBattles(bluePieces, redPieces, onBattleStart, onBattleEnd) {
        // Find close opposing pieces not already in battle
        for (const bp of bluePieces) {
            if (!bp.alive || bp.inBattle) continue;
            for (const rp of redPieces) {
                if (!rp.alive || rp.inBattle) continue;

                const dist = bp.position.distanceTo(rp.position);
                if (dist < BATTLE_DISTANCE) {
                    const battle = new Battle(bp, rp, (winner, loser, side) => {
                        this.activeBattles = this.activeBattles.filter(b => b !== battle);
                        onBattleEnd(battle, winner, loser, side);
                    });
                    this.activeBattles.push(battle);
                    onBattleStart(battle);
                    return; // Only start one battle at a time per frame
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
