import * as THREE from 'three';

/**
 * Simple AI controller for non-player tetrominoes.
 * Handles target selection and lateral movement decisions.
 */

export class AIController {
    constructor() {
        this.retargetInterval = 2.0; // Seconds between retargeting
        this.timers = new Map(); // pieceId -> timer
    }

    update(dt, pieces, enemyPieces) {
        for (const piece of pieces) {
            if (!piece.alive) continue;

            // Initialize timer
            if (!this.timers.has(piece.group.id)) {
                this.timers.set(piece.group.id, 0);
            }

            let timer = this.timers.get(piece.group.id) + dt;

            // Retarget periodically or if target is dead
            if (timer >= this.retargetInterval || !piece.targetEnemy || !piece.targetEnemy.alive) {
                piece.targetEnemy = this._findBestTarget(piece, enemyPieces);
                timer = 0;
            }

            this.timers.set(piece.group.id, timer);
        }
    }

    _findBestTarget(piece, enemies) {
        let best = null;
        let bestScore = -Infinity;

        for (const enemy of enemies) {
            if (!enemy.alive) continue;

            const dist = piece.position.distanceTo(enemy.position);
            // Prefer closer, smaller enemies
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
    }
}
