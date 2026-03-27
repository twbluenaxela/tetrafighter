/**
 * TetraFighter Game Server
 * - Serves static files
 * - WebSocket for lobby + room management + game state relay
 */

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

// ============================================================
// MIME TYPES
// ============================================================
const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.wasm': 'application/wasm',
};

// ============================================================
// STATIC FILE SERVER
// ============================================================
const httpServer = createServer(async (req, res) => {
    let url = req.url.split('?')[0];
    if (url === '/') url = '/index.html';

    const filePath = join(__dirname, url);
    const ext = extname(filePath);

    try {
        const data = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

// ============================================================
// ROOM MANAGEMENT
// ============================================================
const rooms = new Map();    // roomCode -> Room
const clients = new Map();  // ws -> ClientInfo

function generateCode(len = 6) {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function createRoom({ name, isPublic, password, hostId }) {
    const code = generateCode();
    const room = {
        code,
        name: name || `Room ${code}`,
        isPublic: !!isPublic,
        password: password || null,    // null = no password
        host: hostId,
        players: [],                   // { id, name, team, ws }
        state: 'waiting',              // waiting | playing | finished
        createdAt: Date.now(),
    };
    rooms.set(code, room);
    return room;
}

const MAX_TEAM_SIZE = 5;

function getRoomSummary(room) {
    return {
        code: room.code,
        name: room.name,
        isPublic: room.isPublic,
        hasPassword: !!room.password,
        host: room.host,
        playerCount: room.players.length,
        state: room.state,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            team: p.team,
            isAI: p.isAI || false,
        })),
    };
}

function teamCount(room, team) {
    return room.players.filter(p => p.team === team).length;
}

function getPublicRoomList() {
    const list = [];
    for (const room of rooms.values()) {
        if (room.isPublic && room.state === 'waiting') {
            list.push(getRoomSummary(room));
        }
    }
    return list;
}

function broadcastToRoom(room, msg, excludeWs = null) {
    const payload = JSON.stringify(msg);
    for (const p of room.players) {
        if (p.ws && p.ws !== excludeWs && p.ws.readyState === 1) {
            p.ws.send(payload);
        }
    }
}

function removePlayerFromRoom(playerId) {
    for (const [code, room] of rooms) {
        const idx = room.players.findIndex(p => p.id === playerId);
        if (idx === -1) continue;

        room.players.splice(idx, 1);

        // Delete room if no real players left (AI-only rooms don't make sense)
        const hasHumans = room.players.some(p => !p.isAI);
        if (!hasHumans) {
            rooms.delete(code);
            return;
        }

        // Transfer host if needed
        if (room.host === playerId) {
            room.host = room.players[0].id;
        }

        broadcastToRoom(room, {
            type: 'room_update',
            room: getRoomSummary(room),
        });
        return;
    }
}

// ============================================================
// WEBSOCKET SERVER
// ============================================================
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
    const clientId = generateCode(8);
    clients.set(ws, { id: clientId, name: 'Player', roomCode: null });

    ws.send(JSON.stringify({ type: 'welcome', id: clientId }));

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

        const client = clients.get(ws);
        if (!client) return;

        switch (msg.type) {
            case 'set_name': {
                client.name = (msg.name || 'Player').slice(0, 20);
                break;
            }

            case 'create_room': {
                // Leave any existing room
                removePlayerFromRoom(client.id);

                const room = createRoom({
                    name: msg.name,
                    isPublic: msg.isPublic,
                    password: msg.password,
                    hostId: client.id,
                });

                const team = msg.team || 'blue';
                room.players.push({ id: client.id, name: client.name, team, ws });
                client.roomCode = room.code;

                ws.send(JSON.stringify({
                    type: 'room_joined',
                    room: getRoomSummary(room),
                    you: client.id,
                }));
                break;
            }

            case 'join_room': {
                const room = rooms.get(msg.code?.toUpperCase());
                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
                    return;
                }
                if (room.state !== 'waiting') {
                    ws.send(JSON.stringify({ type: 'error', message: 'Game already in progress' }));
                    return;
                }
                if (room.password && msg.password !== room.password) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Wrong password' }));
                    return;
                }

                // Leave any existing room
                removePlayerFromRoom(client.id);

                const team = msg.team || 'red';
                if (teamCount(room, team) >= MAX_TEAM_SIZE) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Team is full (max 5)' }));
                    return;
                }
                room.players.push({ id: client.id, name: client.name, team, ws });
                client.roomCode = room.code;

                ws.send(JSON.stringify({
                    type: 'room_joined',
                    room: getRoomSummary(room),
                    you: client.id,
                }));

                broadcastToRoom(room, {
                    type: 'room_update',
                    room: getRoomSummary(room),
                }, ws);
                break;
            }

            case 'join_random': {
                const publicRooms = getPublicRoomList()
                    .filter(r => !r.hasPassword && r.playerCount < 10);
                if (publicRooms.length === 0) {
                    ws.send(JSON.stringify({ type: 'error', message: 'No public rooms available' }));
                    return;
                }
                const pick = publicRooms[Math.floor(Math.random() * publicRooms.length)];
                const room = rooms.get(pick.code);

                removePlayerFromRoom(client.id);

                // Auto-assign to team with fewer players
                const blueCount = room.players.filter(p => p.team === 'blue').length;
                const redCount = room.players.filter(p => p.team === 'red').length;
                const team = blueCount <= redCount ? 'blue' : 'red';

                room.players.push({ id: client.id, name: client.name, team, ws });
                client.roomCode = room.code;

                ws.send(JSON.stringify({
                    type: 'room_joined',
                    room: getRoomSummary(room),
                    you: client.id,
                }));

                broadcastToRoom(room, {
                    type: 'room_update',
                    room: getRoomSummary(room),
                }, ws);
                break;
            }

            case 'switch_team': {
                const room = rooms.get(client.roomCode);
                if (!room) return;
                const player = room.players.find(p => p.id === client.id);
                if (player) {
                    const targetTeam = player.team === 'blue' ? 'red' : 'blue';
                    if (teamCount(room, targetTeam) >= MAX_TEAM_SIZE) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Team is full (max 5)' }));
                        return;
                    }
                    player.team = targetTeam;
                    broadcastToRoom(room, {
                        type: 'room_update',
                        room: getRoomSummary(room),
                    });
                }
                break;
            }

            case 'add_ai': {
                const room = rooms.get(client.roomCode);
                if (!room || room.host !== client.id) return;
                const aiTeam = msg.team || 'blue';
                if (teamCount(room, aiTeam) >= MAX_TEAM_SIZE) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Team is full (max 5)' }));
                    return;
                }
                const aiId = 'ai_' + generateCode();
                const aiNum = room.players.filter(p => p.isAI).length + 1;
                room.players.push({
                    id: aiId,
                    name: `AI Bot ${aiNum}`,
                    team: aiTeam,
                    ws: null,
                    isAI: true,
                });
                broadcastToRoom(room, {
                    type: 'room_update',
                    room: getRoomSummary(room),
                });
                break;
            }

            case 'remove_ai': {
                const room = rooms.get(client.roomCode);
                if (!room || room.host !== client.id) return;
                const rmTeam = msg.team || 'blue';
                // Remove the last AI from the specified team
                for (let i = room.players.length - 1; i >= 0; i--) {
                    if (room.players[i].isAI && room.players[i].team === rmTeam) {
                        room.players.splice(i, 1);
                        break;
                    }
                }
                broadcastToRoom(room, {
                    type: 'room_update',
                    room: getRoomSummary(room),
                });
                break;
            }

            case 'leave_room': {
                removePlayerFromRoom(client.id);
                client.roomCode = null;
                ws.send(JSON.stringify({ type: 'room_left' }));
                break;
            }

            case 'list_rooms': {
                ws.send(JSON.stringify({
                    type: 'room_list',
                    rooms: getPublicRoomList(),
                }));
                break;
            }

            case 'start_game': {
                const room = rooms.get(client.roomCode);
                if (!room || room.host !== client.id) return;
                const hasBlue = room.players.some(p => p.team === 'blue');
                const hasRed = room.players.some(p => p.team === 'red');
                if (!hasBlue || !hasRed) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Need at least 1 player on each team' }));
                    return;
                }
                room.state = 'playing';
                broadcastToRoom(room, {
                    type: 'game_start',
                    room: getRoomSummary(room),
                });
                break;
            }

            case 'request_rematch': {
                const room = rooms.get(client.roomCode);
                if (!room || room.host !== client.id) return;
                room.state = 'playing';
                broadcastToRoom(room, {
                    type: 'game_start',
                    room: getRoomSummary(room),
                });
                break;
            }

            // === GAME STATE RELAY ===
            case 'game_state': {
                // Relay player's state to all others in room
                const room = rooms.get(client.roomCode);
                if (!room || room.state !== 'playing') return;
                broadcastToRoom(room, {
                    type: 'player_state',
                    id: client.id,
                    state: msg.state,
                }, ws);
                break;
            }

            case 'game_event': {
                // Relay game events (connections, kills, etc.)
                const room = rooms.get(client.roomCode);
                if (!room || room.state !== 'playing') return;
                broadcastToRoom(room, {
                    type: 'game_event',
                    id: client.id,
                    event: msg.event,
                }, ws);
                break;
            }

            case 'game_over': {
                const room = rooms.get(client.roomCode);
                if (!room) return;
                room.state = 'waiting';
                broadcastToRoom(room, {
                    type: 'game_over',
                    results: msg.results,
                });
                break;
            }
        }
    });

    ws.on('close', () => {
        const client = clients.get(ws);
        if (client) {
            removePlayerFromRoom(client.id);
            clients.delete(ws);
        }
    });
});

// ============================================================
// CLEANUP STALE ROOMS
// ============================================================
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
        // Remove rooms older than 1 hour with no players
        if (room.players.length === 0 && now - room.createdAt > 3600000) {
            rooms.delete(code);
        }
    }
}, 60000);

// ============================================================
// START
// ============================================================
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`TetraFighter server running on port ${PORT}`);
});
