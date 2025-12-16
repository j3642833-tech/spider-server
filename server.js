const WebSocket = require('ws');

// SETUP SERVER
const port = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port }, () => {
    console.log(`Spider Kingdom running on port ${port}`);
});

// GAME VARIABLES
let players = {};
let sockets = {};
let nextId = 1;

wss.on('connection', (ws) => {
    const id = 'p' + nextId++;
    sockets[id] = ws;
    console.log(`Player ${id} connected`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. JOIN - This is where the magic happens
            if (data.type === 'join') {
                players[id] = {
                    id: id,
                    x: Math.random() * 2000 + 1000,
                    y: Math.random() * 2000 + 1000,
                    r: 60,
                    name: data.name || "Spider",
                    skin: data.skin || null,
                    vip: data.vip || false, // It accepts 'false' for non-VIPs!
                    kills: 0,
                    angle: 0,
                    dead: false,
                    emoji: null,
                    emojiTimer: 0
                };
                
                // SEND INIT - This unlocks your spider!
                ws.send(JSON.stringify({ 
                    type: 'init', 
                    id: id, 
                    x: players[id].x, 
                    y: players[id].y 
                }));
            }

            // 2. MOVE
            if (data.type === 'move' && players[id] && !players[id].dead) {
                let p = players[id];
                if (data.dx || data.dy) {
                    p.angle = Math.atan2(data.dy, data.dx);
                    let speed = Math.max(4, 8 - (p.r - 60) * 0.01);
                    p.x += data.dx * speed;
                    p.y += data.dy * speed;
                    // Boundaries
                    p.x = Math.max(0, Math.min(5000, p.x));
                    p.y = Math.max(0, Math.min(5000, p.y));
                }
            }

            // 3. EMOJI
            if (data.type === 'emoji' && players[id]) {
                players[id].emoji = data.index;
                players[id].emojiTimer = 300;
            }
            
            // 4. RESPAWN
            if (data.type === 'respawn' && players[id]) {
                players[id].dead = false;
                players[id].x = Math.random() * 2000 + 1000;
                players[id].y = Math.random() * 2000 + 1000;
            }

        } catch (e) { console.error(e); }
    });

    ws.on('close', () => {
        delete players[id];
        delete sockets[id];
    });
});

// GAME LOOP (60 FPS)
setInterval(() => {
    let pack = [];
    for (let id in players) {
        let p = players[id];
        // Emoji Timer
        if (p.emojiTimer > 0) { p.emojiTimer--; if(p.emojiTimer<=0) p.emoji=null; }
        
        // Simple Collision (Eat logic)
        if (!p.dead) {
            for (let oid in players) {
                if (id === oid) continue;
                let o = players[oid];
                if (o.dead) continue;
                let dist = Math.hypot(p.x - o.x, p.y - o.y);
                if (dist < p.r && p.r > o.r * 1.1) {
                    o.dead = true;
                    p.r = Math.min(300, p.r + o.r * 0.2);
                    p.kills++;
                }
            }
        }
        pack.push(p);
    }
    
    // SEND UPDATE TO ALL
    const msg = JSON.stringify({ type: 'update', players: pack });
    for (let id in sockets) {
        if (sockets[id].readyState === WebSocket.OPEN) sockets[id].send(msg);
    }
}, 1000 / 60);
