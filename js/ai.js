import * as THREE from 'three';

/**
 * AI controller for non-player tetrominoes.
 * Handles target selection, body rotation, and tactical movement.
 */

export class AIController {
    constructor() {
        this.retargetInterval = 2.0;
        this.timers = new Map();        // pieceId -> retarget timer
        this.rotateTimers = new Map();   // pieceId -> rotation timer
    }

    update(dt, pieces, enemyPieces) {
        for (const piece of pieces) {
            if (!piece.alive) continue;

            const id = piece.group.id;

            // Initialize timers
            if (!this.timers.has(id)) {
                this.timers.set(id, 0);
                this.rotateTimers.set(id, 1.0 + Math.random() * 2.0);
            }

            // Retarget periodically or if target is dead
            let timer = this.timers.get(id) + dt;
            if (timer >= this.retargetInterval || !piece.targetEnemy || !piece.targetEnemy.alive) {
                piece.targetEnemy = this._findBestTarget(piece, enemyPieces);
                timer = 0;
            }
            this.timers.set(id, timer);

            // Rotate body periodically to try different orientations
            let rotTimer = this.rotateTimers.get(id) - dt;
            if (rotTimer <= 0) {
                piece.rotateBody(Math.random() < 0.5 ? 1 : -1);
                rotTimer = 1.5 + Math.random() * 3.0;
            }
            this.rotateTimers.set(id, rotTimer);
        }
    }

    _findBestTarget(piece, enemies) {
        let best = null;
        let bestScore = -Infinity;

        for (const enemy of enemies) {
            if (!enemy.alive) continue;

            const dist = piece.position.distanceTo(enemy.position);
            const score = -dist + (enemy.blocks.length < piece.blocks.length ? 5 : -3);

            if (score > bestScore) {
                bestScore = score;
                best = enemy;
            }
        }

        return best;
    }

    cleanup(piece) {
        this.timers.delete(piece.group.id);
        this.rotateTimers.delete(piece.group.id);
    }
}
