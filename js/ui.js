/**
 * UI Manager — HUD, battle overlay, minimap, notifications, game-over showcase
 */
import { t } from './i18n.js';

export class UIManager {
    constructor() {
        this.hud = document.getElementById('hud');
        this.blueScore = document.getElementById('blue-score');
        this.redScore = document.getElementById('red-score');
        this.bluePieces = document.getElementById('blue-pieces');
        this.redPieces = document.getElementById('red-pieces');
        this.timer = document.getElementById('game-timer');
        this.blueArtCount = document.getElementById('blue-art-count');
        this.redArtCount = document.getElementById('red-art-count');

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

    hideHUD() {
        this.hud.style.display = 'none';
    }

    hideStartScreen() {
        this.startScreen.style.display = 'none';
    }

    updateScores(blueScore, redScore) {
        this.blueScore.textContent = blueScore;
        this.redScore.textContent = redScore;
    }

    updatePieceCounts(blueCount, redCount) {
        this.bluePieces.textContent = t('fighters', blueCount);
        this.redPieces.textContent = t('fighters', redCount);
    }

    updateArtCounts(blueArt, redArt) {
        if (this.blueArtCount) this.blueArtCount.textContent = t('artShapes', blueArt);
        if (this.redArtCount) this.redArtCount.textContent = t('artShapes', redArt);
    }

    updateTimer(secondsLeft) {
        const m = Math.floor(secondsLeft / 60);
        const s = Math.floor(secondsLeft % 60);
        this.timer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }

    showGameOver(blueWins, blueCount, redCount) {
        this.gameOver.classList.add('active');
        if (blueWins) {
            this.gameOverTitle.textContent = t('blueWinsTitle');
            this.gameOverTitle.style.color = '#4fc3f7';
            this.gameOverText.textContent = t('blueWinsText', blueCount, redCount);
        } else if (blueCount === redCount) {
            this.gameOverTitle.textContent = t('drawTitle');
            this.gameOverTitle.style.color = '#aaaaaa';
            this.gameOverText.textContent = t('drawText', blueCount);
        } else {
            this.gameOverTitle.textContent = t('redWinsTitle');
            this.gameOverTitle.style.color = '#ef5350';
            this.gameOverText.textContent = t('redWinsText', redCount, blueCount);
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

        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, 0, w, h);

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

        // Sculpture zones (side indicators)
        ctx.fillStyle = 'rgba(79,195,247,0.1)';
        ctx.fillRect(0, 0, 8, h);
        ctx.fillStyle = 'rgba(239,83,80,0.1)';
        ctx.fillRect(w - 8, 0, 8, h);

        const drawPiece = (piece, color, isPlayer) => {
            if (!piece.alive) return;
            const px = (piece.position.x - fieldBounds.minX) * scaleX;
            const pz = (piece.position.z - fieldBounds.minZ) * scaleZ;

            ctx.fillStyle = color;
            const size = 3.5;

            if (isPlayer) {
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
                ctx.beginPath();
                ctx.arc(px, pz, size, 0, Math.PI * 2);
                ctx.fill();
            }
        };

        bluePieces.forEach(p => drawPiece(p, '#4fc3f7', p === playerPiece));
        redPieces.forEach(p => drawPiece(p, '#ef5350', false));
    }
}
