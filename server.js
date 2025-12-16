const WebSocket = require('ws');

// 1. SETUP SERVER
const port = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port }, () => {
    console.log(`Spider Kingdom running on port ${port}`);
});

// 2. MULTI-LOBBY SYSTEM
const MAX_PLAYERS = 30;
let lobbies = []; 

class Lobby {
    constructor(id) {
        this.id = id;
        this.players = {};
        this.items = [];
        this.sockets = {}; 
        this.itemCounter = 0;
        
        // Initial Items (80 items per map)
        for(let i=0; i<80; i++) this.spawnItem();
    }

    spawnItem() {
        this.items.push({
            id: this.itemCounter++,
            x: Math.random() * 4800 + 100,
            y: Math.random() * 4800 + 100,
            t: Math.floor(Math.random() * 5) // 0:HP, 1:Spd, 2:Shd, 3:Web, 4:Rope
        });
    }

    get count() { return Object.keys(this.players).length; }
}

// Create Lobby #1
lobbies.push(new Lobby(1));

// 3. CONNECTION HANDLER
wss.on('connection', (ws) => {
    
    // Auto-Join Logic: Find first lobby with space
    let lobby = lobbies.find(l => l.count < MAX_PLAYERS);
    if (!lobby) {
        lobby = new Lobby(lobbies.length + 1);
        lobbies.push(lobby);
        console.log(`Created Lobby ${lobby.id}`);
    }

    const id = 'p' + Math.floor(Math.random() * 9999999);
    lobby.sockets[id] = ws;
    ws.lobbyIndex = lobbies.indexOf(lobby); // Remember lobby
    ws.playerId = id;

    console.log(`Player ${id} joined Lobby ${lobby.id}`);

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            const myLobby = lobbies[ws.lobbyIndex];
            if (!myLobby) return;

            // JOIN
            if (data.type === 'join') {
                myLobby.players[id] = {
                    id: id,
                    x: Math.random() * 4000 + 500,
                    y: Math.random() * 4000 + 500,
                    r: 60,
                    name: data.name || "Spider",
                    skin: data.skin || null,
                    vip: data.vip || false,
                    kills: 0,
                    angle: 0,
                    anim: 0, // Animation Frame
                    atk: false, // Biting State
                    dead: false,
                    emoji: null,
                    emojiTimer: 0
                };
                // Send Init Packet
                ws.send(JSON.stringify({ 
                    type: 'init', 
                    id: id, 
                    x: myLobby.players[id].x, 
                    y: myLobby.players[id].y 
                }));
            }

            // INPUT
            if (data.type === 'move' && myLobby.players[id] && !myLobby.players[id].dead) {
                let p = myLobby.players[id];
                p.atk = data.atk; // Sync Attack State
                
                if (data.dx || data.dy) {
                    p.angle = Math.atan2(data.dy, data.dx);
                    
                    // Speed Calculation (Bigger = Slower)
                    let speed = Math.max(4, 8 - (p.r - 60) * 0.01);
                    p.x += data.dx * speed;
                    p.y += data.dy * speed;
                    p.anim += 0.35; // Advance Animation
                    
                    // Map Borders (5000x5000)
                    p.x = Math.max(0, Math.min(5000, p.x));
                    p.y = Math.max(0, Math.min(5000, p.y));
                }
            }

            // EMOJI
            if (data.type === 'emoji' && myLobby.players[id]) {
                myLobby.players[id].emoji = data.index;
                myLobby.players[id].emojiTimer = 300; // 5 Seconds
            }

            // RESPAWN (VIP Logic)
            if (data.type === 'respawn' && myLobby.players[id]) {
                let p = myLobby.players[id];
                p.dead = false;
                p.x = Math.random() * 4000 + 500;
                p.y = Math.random() * 4000 + 500;
                // If VIP mode, we keep Mass & Kills. If not, reset?
                // Your request said VIPs keep stats. Logic implies non-VIPs reset on client side before re-joining.
            }

        } catch (e) {}
    });

    ws.on('close', () => {
        let myLobby = lobbies[ws.lobbyIndex];
        if (myLobby) {
            delete myLobby.players[id];
            delete myLobby.sockets[id];
        }
    });
});

// 4. GAME LOOP (60 FPS)
setInterval(() => {
    lobbies.forEach(lobby => {
        let pack = [];
        
        // Spawn Items if low
        if(lobby.items.length < 50) lobby.spawnItem();

        for (let id in lobby.players) {
            let p = lobby.players[id];

            // Emoji Timer
            if (p.emojiTimer > 0) {
                p.emojiTimer--;
                if (p.emojiTimer <= 0) p.emoji = null;
            }

            if (!p.dead) {
                // ITEM COLLISION
                for (let i = lobby.items.length - 1; i >= 0; i--) {
                    let it = lobby.items[i];
                    if (Math.hypot(p.x - it.x, p.y - it.y) < p.r + 30) {
                        lobby.items.splice(i, 1);
                        // Apply Buff (Simplified Server Side)
                        if(it.t === 0) p.r = Math.min(300, p.r + 10); // Health = Mass gain
                    }
                }

                // PLAYER COMBAT
                for (let oid in lobby.players) {
                    if (id === oid) continue;
                    let o = lobby.players[oid];
                    if (o.dead) continue;

                    let dist = Math.hypot(p.x - o.x, p.y - o.y);
                    
                    // Eating Logic (Must be 20% bigger)
                    if (dist < p.r && p.r > o.r * 1.2) {
                        o.dead = true;
                        p.r = Math.min(300, p.r + o.r * 0.4); // Absorb 40%
                        p.kills++;
                    }
                }
            }
            pack.push(p);
        }

        // Broadcast to Lobby
        const updateMsg = JSON.stringify({ type: 'update', players: pack, items: lobby.items });
        for (let id in lobby.sockets) {
            if (lobby.sockets[id].readyState === WebSocket.OPEN) {
                lobby.sockets[id].send(updateMsg);
            }
        }
    });
}, 1000 / 60);
