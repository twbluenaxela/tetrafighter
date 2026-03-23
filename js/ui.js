/**
 * UI Manager — updates HUD, battle overlay, minimap, notifications
 */

export class UIManager {
    constructor() {
        this.hud = document.getElementById('hud');
        this.blueScore = document.getElementById('blue-score');
        this.redScore = document.getElementById('red-score');
        this.bluePieces = document.getElementById('blue-pieces');
        this.redPieces = document.getElementById('red-pieces');
        this.timer = document.getElementById('game-timer');

        this.battleOverlay = document.getElementById('battle-overlay');
        this.battleBarPlayer = document.getElementById('battle-bar-player');
        this.battleBarEnemy = document.getElementById('battle-bar-enemy');

        this.startScreen = document.getElementById('start-screen');
        this.gameOver = document.getElementById('game-over');
        this.gameOverTitle = document.getElementById('game-over-title');
        this.gameOverText = document.getElementById('game-over-text');

        this.notifications = document.getElementById('notifications');
        this.minimapCanvas = document.getElementById('minimap-canvas');
        this.minimapCtx = this.minimapCanvas.getContext('2d');
    }

    showHUD() {
        this.hud.style.display = 'block';
    }

    hideStartScreen() {
        this.startScreen.style.display = 'none';
    }

    updateScores(blueScore, redScore) {
        this.blueScore.textContent = blueScore;
        this.redScore.textContent = redScore;
    }

    updatePieceCounts(blueCount, redCount) {
        this.bluePieces.textContent = `Pieces: ${blueCount}`;
        this.redPieces.textContent = `Pieces: ${redCount}`;
    }

    updateTimer(secondsLeft) {
        const m = Math.floor(secondsLeft / 60);
        const s = Math.floor(secondsLeft % 60);
        this.timer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }

    showBattle(meterA, meterB) {
        this.battleOverlay.classList.add('active');
        this.battleBarPlayer.style.width = `${meterA}%`;
        this.battleBarEnemy.style.width = `${meterB}%`;
    }

    hideBattle() {
        this.battleOverlay.classList.remove('active');
    }

    showGameOver(blueWins) {
        this.gameOver.classList.add('active');
        if (blueWins) {
            this.gameOverTitle.textContent = 'VICTORY!';
            this.gameOverTitle.style.color = '#4fc3f7';
            this.gameOverText.textContent = 'Blue team dominates the field!';
        } else {
            this.gameOverTitle.textContent = 'DEFEAT';
            this.gameOverTitle.style.color = '#ef5350';
            this.gameOverText.textContent = 'Red team has overwhelmed you.';
        }
    }

    hideGameOver() {
        this.gameOver.classList.remove('active');
    }

    notify(text) {
        const el = document.createElement('div');
        el.className = 'notification';
        el.textContent = text;
        this.notifications.appendChild(el);
        setTimeout(() => el.remove(), 2200);
    }

    flashScreen() {
        const flash = document.createElement('div');
        flash.className = 'connection-flash';
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 400);
    }

    updateMinimap(bluePieces, redPieces, playerPiece, fieldBounds) {
        const ctx = this.minimapCtx;
        const w = 160, h = 160;
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, 0, w, h);

        // Field area
        const fieldW = fieldBounds.maxX - fieldBounds.minX;
        const fieldH = fieldBounds.maxZ - fieldBounds.minZ;

        const scaleX = w / fieldW;
        const scaleZ = h / fieldH;

        // Center line
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Draw pieces
        const drawPiece = (piece, color, isPlayer) => {
            if (!piece.alive) return;
            const px = (piece.position.x - fieldBounds.minX) * scaleX;
            const pz = (piece.position.z - fieldBounds.minZ) * scaleZ;

            ctx.fillStyle = color;
            const size = Math.max(3, Math.sqrt(piece.blocks.length) * 2.5);

            if (isPlayer) {
                // Player indicator - diamond
                ctx.beginPath();
                ctx.moveTo(px, pz - size - 1);
                ctx.lineTo(px + size + 1, pz);
                ctx.lineTo(px, pz + size + 1);
                ctx.lineTo(px - size - 1, pz);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.stroke();
            } else {
                ctx.fillRect(px - size / 2, pz - size / 2, size, size);
            }
        };

        bluePieces.forEach(p => drawPiece(p, '#4fc3f7', p === playerPiece));
        redPieces.forEach(p => drawPiece(p, '#ef5350', false));
    }
}
