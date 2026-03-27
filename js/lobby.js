/**
 * Lobby Manager — handles all lobby UI interactions
 * Connects to the game server, manages room creation/joining/browsing
 */

import * as net from './network.js';
import { t, applyStaticTranslations } from './i18n.js';

let onGameStart = null;  // callback when PvP game starts

export function init(gameStartCallback) {
    onGameStart = gameStartCallback;

    // Cache DOM elements
    const startScreen = document.getElementById('start-screen');
    const lobbyScreen = document.getElementById('lobby-screen');
    const roomScreen = document.getElementById('room-screen');

    // ============================================================
    // START SCREEN — mode selection
    // ============================================================
    const btnPve = document.getElementById('btn-pve');
    const btnPvp = document.getElementById('btn-pvp');
    const playerNameInput = document.getElementById('player-name');

    // Load saved name
    const savedName = localStorage.getItem('tetrafighter-name') || '';
    if (savedName) playerNameInput.value = savedName;

    btnPve.addEventListener('click', () => {
        localStorage.setItem('tetrafighter-name', playerNameInput.value);
        if (onGameStart) onGameStart({ mode: 'pve' });
    });

    btnPvp.addEventListener('click', () => {
        localStorage.setItem('tetrafighter-name', playerNameInput.value);
        // Show lobby immediately — connect lazily when creating/joining
        showScreen('lobby');
    });

    // ============================================================
    // LOBBY SCREEN — tabs
    // ============================================================
    const tabs = lobbyScreen.querySelectorAll('.lobby-tab');
    const panels = {
        create: document.getElementById('panel-create'),
        join: document.getElementById('panel-join'),
        browse: document.getElementById('panel-browse'),
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', async () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            Object.values(panels).forEach(p => p.style.display = 'none');
            panels[tab.dataset.tab].style.display = 'flex';

            if (tab.dataset.tab === 'browse' && net.isConnected()) {
                net.listRooms();
            }
        });
    });

    // Visibility toggle (public/private)
    const btnPublic = document.getElementById('btn-public');
    const btnPrivate = document.getElementById('btn-private');
    const passwordGroup = document.getElementById('password-group');

    btnPublic.addEventListener('click', () => {
        btnPublic.classList.add('active');
        btnPrivate.classList.remove('active');
        passwordGroup.style.display = 'none';
    });

    btnPrivate.addEventListener('click', () => {
        btnPrivate.classList.add('active');
        btnPublic.classList.remove('active');
        passwordGroup.style.display = 'flex';
    });

    // Team toggles — create panel
    setupTeamToggle('create-team-blue', 'create-team-red');
    // Team toggles — join panel
    setupTeamToggle('join-team-blue', 'join-team-red');

    // Helper: ensure connected before any server action
    async function ensureConnected() {
        if (net.isConnected()) return true;
        try {
            await net.connect();
            net.setName(playerNameInput.value || 'Player');
            return true;
        } catch {
            showError(lobbyScreen, t('connectionFailed'));
            return false;
        }
    }

    // Create room
    document.getElementById('btn-create-room').addEventListener('click', async () => {
        if (!await ensureConnected()) return;
        const name = document.getElementById('create-room-name').value || undefined;
        const isPublic = btnPublic.classList.contains('active');
        const password = !isPublic ? document.getElementById('create-room-password').value || undefined : undefined;
        const team = document.getElementById('create-team-blue').classList.contains('active') ? 'blue' : 'red';

        net.createRoom({ name, isPublic, password, team });
    });

    // Join room by code
    document.getElementById('btn-join-room').addEventListener('click', async () => {
        if (!await ensureConnected()) return;
        const code = document.getElementById('join-code').value.trim().toUpperCase();
        if (!code) return;
        const password = document.getElementById('join-password').value || undefined;
        const team = document.getElementById('join-team-blue').classList.contains('active') ? 'blue' : 'red';
        net.joinRoom(code, password, team);
    });

    // Join random
    document.getElementById('btn-join-random').addEventListener('click', async () => {
        if (!await ensureConnected()) return;
        net.joinRandom();
    });

    // Refresh rooms
    document.getElementById('btn-refresh-rooms').addEventListener('click', async () => {
        if (!await ensureConnected()) return;
        net.listRooms();
    });

    // Back to menu
    document.getElementById('btn-back-to-menu').addEventListener('click', () => {
        net.disconnect();
        showScreen('start');
    });

    // ============================================================
    // Check for invite code in URL
    // ============================================================
    const urlParams = new URLSearchParams(window.location.search);
    const inviteCode = urlParams.get('room');
    if (inviteCode) {
        // Auto-connect and join
        (async () => {
            try {
                await net.connect();
                net.setName(playerNameInput.value || 'Player');
                document.getElementById('join-code').value = inviteCode.toUpperCase();
                showScreen('lobby');
                // Switch to join tab
                tabs.forEach(t => t.classList.remove('active'));
                lobbyScreen.querySelector('[data-tab="join"]').classList.add('active');
                Object.values(panels).forEach(p => p.style.display = 'none');
                panels.join.style.display = 'flex';
            } catch {
                // Fall through to normal start screen
            }
        })();
    }

    // ============================================================
    // ROOM SCREEN
    // ============================================================
    document.getElementById('btn-switch-team').addEventListener('click', () => {
        net.switchTeam();
    });

    document.getElementById('btn-start-pvp').addEventListener('click', () => {
        net.startGame();
    });

    document.getElementById('btn-leave-room').addEventListener('click', () => {
        net.leaveRoom();
        showScreen('lobby');
    });

    document.getElementById('btn-copy-code').addEventListener('click', () => {
        const code = document.getElementById('room-code').textContent;
        navigator.clipboard.writeText(code).catch(() => {});
    });

    document.getElementById('btn-copy-link').addEventListener('click', () => {
        const code = document.getElementById('room-code').textContent;
        const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
        navigator.clipboard.writeText(url).catch(() => {});
    });

    // ============================================================
    // NETWORK EVENT HANDLERS
    // ============================================================
    net.on('room_joined', (msg) => {
        updateRoomScreen(msg.room, msg.you);
        showScreen('room');
    });

    net.on('room_update', (msg) => {
        updateRoomScreen(msg.room, net.getMyId());
    });

    net.on('room_left', () => {
        showScreen('lobby');
    });

    net.on('room_list', (msg) => {
        renderRoomList(msg.rooms);
    });

    net.on('error', (msg) => {
        // Show error on whichever screen is visible
        const visible = lobbyScreen.style.display !== 'none' ? lobbyScreen :
                        roomScreen.style.display !== 'none' ? roomScreen :
                        startScreen;
        showError(visible, msg.message);
    });

    net.on('game_start', (msg) => {
        if (onGameStart) {
            onGameStart({
                mode: 'pvp',
                room: msg.room,
                myId: net.getMyId(),
            });
        }
    });

    net.on('disconnected', () => {
        showScreen('start');
    });
}

// ============================================================
// HELPERS
// ============================================================
function showScreen(name) {
    document.getElementById('start-screen').style.display = name === 'start' ? 'flex' : 'none';
    document.getElementById('lobby-screen').style.display = name === 'lobby' ? 'flex' : 'none';
    document.getElementById('room-screen').style.display = name === 'room' ? 'flex' : 'none';
    applyStaticTranslations();
}

function setupTeamToggle(blueId, redId) {
    const blue = document.getElementById(blueId);
    const red = document.getElementById(redId);
    blue.addEventListener('click', () => {
        blue.classList.add('active');
        red.classList.remove('active');
    });
    red.addEventListener('click', () => {
        red.classList.add('active');
        blue.classList.remove('active');
    });
}

function updateRoomScreen(room, myId) {
    document.getElementById('room-title').textContent = room.name;
    document.getElementById('room-code').textContent = room.code;

    // Player lists
    const blueList = document.getElementById('blue-player-list');
    const redList = document.getElementById('red-player-list');
    blueList.innerHTML = '';
    redList.innerHTML = '';

    for (const p of room.players) {
        const li = document.createElement('li');
        li.textContent = p.name;
        if (p.id === room.host) li.classList.add('is-host');
        if (p.id === myId) li.classList.add('is-you');

        if (p.team === 'blue') blueList.appendChild(li);
        else redList.appendChild(li);
    }

    // Show start button only for host
    const isHost = room.host === myId;
    const startBtn = document.getElementById('btn-start-pvp');
    startBtn.style.display = isHost ? 'inline-block' : 'none';
}

function renderRoomList(rooms) {
    const container = document.getElementById('room-list');
    container.innerHTML = '';

    if (rooms.length === 0) {
        container.innerHTML = `<p class="room-list-empty">${t('noRooms')}</p>`;
        return;
    }

    for (const room of rooms) {
        const item = document.createElement('div');
        item.className = 'room-list-item';
        item.innerHTML = `
            <div>
                <div class="room-item-name">${escapeHtml(room.name)}</div>
                <div class="room-item-info">${room.playerCount} player${room.playerCount !== 1 ? 's' : ''} ${room.hasPassword ? '🔒' : ''}</div>
            </div>
            <button class="room-item-join">${t('joinRoomBtn')}</button>
        `;
        item.querySelector('.room-item-join').addEventListener('click', () => {
            if (room.hasPassword) {
                const pw = prompt(t('enterPassword'));
                if (pw === null) return;
                net.joinRoom(room.code, pw);
            } else {
                net.joinRoom(room.code);
            }
        });
        container.appendChild(item);
    }
}

function showError(container, message) {
    // Remove existing error
    const existing = container.querySelector('.lobby-error');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'lobby-error';
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
