/**
 * Network client — WebSocket wrapper for lobby and game state
 */

let ws = null;
let myId = null;
let messageHandlers = new Map(); // type -> [callbacks]

export function getMyId() { return myId; }

export function connect() {
    return new Promise((resolve, reject) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            resolve();
            return;
        }

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${location.host}`);

        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('WebSocket connection failed'));

        ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }

            if (msg.type === 'welcome') {
                myId = msg.id;
            }

            const handlers = messageHandlers.get(msg.type);
            if (handlers) {
                for (const fn of handlers) fn(msg);
            }

            // Also fire wildcard handlers
            const wildcards = messageHandlers.get('*');
            if (wildcards) {
                for (const fn of wildcards) fn(msg);
            }
        };

        ws.onclose = () => {
            const handlers = messageHandlers.get('disconnected');
            if (handlers) {
                for (const fn of handlers) fn();
            }
        };
    });
}

export function disconnect() {
    if (ws) {
        ws.close();
        ws = null;
        myId = null;
    }
}

export function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

export function on(type, callback) {
    if (!messageHandlers.has(type)) {
        messageHandlers.set(type, []);
    }
    messageHandlers.get(type).push(callback);
}

export function off(type, callback) {
    const handlers = messageHandlers.get(type);
    if (handlers) {
        const idx = handlers.indexOf(callback);
        if (idx !== -1) handlers.splice(idx, 1);
    }
}

// Convenience methods
export function setName(name) { send({ type: 'set_name', name }); }
export function createRoom(opts) { send({ type: 'create_room', ...opts }); }
export function joinRoom(code, password, team) { send({ type: 'join_room', code, password, team }); }
export function joinRandom() { send({ type: 'join_random' }); }
export function switchTeam() { send({ type: 'switch_team' }); }
export function leaveRoom() { send({ type: 'leave_room' }); }
export function listRooms() { send({ type: 'list_rooms' }); }
export function startGame() { send({ type: 'start_game' }); }
export function requestRematch() { send({ type: 'request_rematch' }); }
export function addAI(team) { send({ type: 'add_ai', team }); }
export function removeAI(team) { send({ type: 'remove_ai', team }); }
export function sendGameState(state) { send({ type: 'game_state', state }); }
export function sendGameEvent(event) { send({ type: 'game_event', event }); }

export function isConnected() {
    return ws && ws.readyState === WebSocket.OPEN;
}
