const WebSocket = require('ws');
const port = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port }, () => console.log(`Kingdom Active on ${port}`));

let players = {};
let items = []; // WE NOW HAVE ITEMS!
let sockets = {};
let nextId = 1;
let itemIdCounter = 0;

// Spawn Initial Items
for(let i=0; i<100; i++) spawnItem();

function spawnItem() {
    items.push({
        id: itemIdCounter++,
        x: Math.random() * 4900 + 50,
        y: Math.random() * 4900 + 50,
        t: Math.floor(Math.random() * 5) // 0:Health, 1:Speed, 2:Shield, 3:Web, 4:Rope
    });
}

wss.on('connection', (ws) => {
    const id = 'p' + nextId++;
    sockets[id] = ws;

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            // JOIN
            if (data.type === 'join') {
                players[id] = {
                    id: id, x: Math.random()*2000+1000, y: Math.random()*2000+1000, r: 60,
                    name: data.name, skin: data.skin, vip: data.vip, kills: 0, angle: 0,
                    dead: false, emoji: null, emojiTimer: 0, atk: false, anim: 0
                };
                ws.send(JSON.stringify({ type: 'init', id: id, x: players[id].x, y: players[id].y }));
            }

            // INPUT (Move + Atk)
            if (data.type === 'move' && players[id] && !players[id].dead) {
                let p = players[id];
                p.atk = data.atk; // Sync Biting
                
                if (data.dx || data.dy) {
                    p.angle = Math.atan2(data.dy, data.dx);
                    let speed = Math.max(4, 8 - (p.r-60)*0.01);
                    p.x += data.dx * speed;
                    p.y += data.dy * speed;
                    p.anim += 0.2; // Server tracks animation progress
                    p.x = Math.max(0, Math.min(5000, p.x));
                    p.y = Math.max(0, Math.min(5000, p.y));
                }
            }
            
            // EMOJI
            if (data.type === 'emoji') {
                players[id].emoji = data.index;
                players[id].emojiTimer = 300;
            }
            
            // RESPAWN
            if (data.type === 'respawn') {
                players[id].dead = false;
                players[id].x = Math.random()*2000+1000;
                players[id].y = Math.random()*2000+1000;
            }

        } catch (e) {}
    });

    ws.on('close', () => { delete players[id]; delete sockets[id]; });
});

// GAME LOOP
setInterval(() => {
    let pack = [];
    
    // 1. Manage Items
    if(items.length < 80) spawnItem();

    for (let id in players) {
        let p = players[id];
        if(p.emojiTimer > 0) p.emojiTimer--; else p.emoji = null;

        if (!p.dead) {
            // Collision with Items
            for (let i = items.length - 1; i >= 0; i--) {
                let it = items[i];
                let dist = Math.hypot(p.x - it.x, p.y - it.y);
                if (dist < p.r + 20) {
                    // Item Collected!
                    items.splice(i, 1);
                    if(it.t === 0) p.r = Math.min(300, p.r + 5); // Grow
                    // Logic for other buffs is handled visually on client for now
                }
            }

            // Collision with Players
            for (let oid in players) {
                if (id === oid) continue;
                let o = players[oid];
                if (o.dead) continue;
                let dist = Math.hypot(p.x - o.x, p.y - o.y);
                if (dist < p.r && p.r > o.r * 1.1) {
                    o.dead = true;
                    p.r = Math.min(300, p.r + o.r * 0.25);
                    p.kills++;
                }
            }
        }
        pack.push(p);
    }

    const updateMsg = JSON.stringify({ type: 'update', players: pack, items: items });
    for (let id in sockets) { if (sockets[id].readyState === 1) sockets[id].send(updateMsg); }
}, 1000 / 60);
