const WebSocket = require('ws');

// SETUP
const port = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port }, () => console.log(`Kingdom active on ${port}`));

const MAX_PLAYERS = 30;
const MAP_SIZE = 5000;
let lobbies = [];

class Lobby {
    constructor(id) {
        this.id = id;
        this.players = {};
        this.items = [];
        this.sockets = {};
        this.itemCounter = 0;
        for(let i=0; i<80; i++) this.spawnItem();
    }

    spawnItem() {
        let r = Math.random();
        let type = 0; 
        if (r < 0.3) type = 3; // Web
        else if (r < 0.6) type = 4; // Rope
        else if (r < 0.8) type = 0; // Health
        else if (r < 0.9) type = 1; // Speed
        else type = 2; // Shield

        this.items.push({
            id: this.itemCounter++,
            x: Math.random() * (MAP_SIZE - 200) + 100,
            y: Math.random() * (MAP_SIZE - 200) + 100,
            t: type
        });
    }
    
    get count() { return Object.keys(this.players).length; }
}

lobbies.push(new Lobby(1));

wss.on('connection', (ws) => {
    let lobby = lobbies.find(l => l.count < MAX_PLAYERS);
    if(!lobby) { lobby = new Lobby(lobbies.length+1); lobbies.push(lobby); }
    
    const id = 'p' + Math.floor(Math.random()*999999);
    lobby.sockets[id] = ws;
    ws.lobbyIndex = lobbies.indexOf(lobby);
    ws.playerId = id;

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            const myLobby = lobbies[ws.lobbyIndex];
            if(!myLobby) return;
            let p = myLobby.players[id];

            if (data.type === 'join') {
                myLobby.players[id] = {
                    id: id, x: Math.random()*3000+1000, y: Math.random()*3000+1000, r: 60,
                    name: data.name, skin: data.skin, vip: data.vip, kills: 0,
                    angle: 0, anim: 0, atk: false, dead: false, emoji: null, emojiTimer: 0,
                    hp: 100, maxHp: 100, web: 0, rope: 0, spdTime: 0, shdTime: 0
                };
                ws.send(JSON.stringify({ type:'init', id:id, x:myLobby.players[id].x, y:myLobby.players[id].y }));
            }

            if (data.type === 'move' && p && !p.dead) {
                p.atk = data.atk;
                if(data.dx || data.dy) {
                    p.angle = Math.atan2(data.dy, data.dx);
                    let speed = Math.max(4, 8 - (p.r-60)*0.01);
                    if(p.spdTime > 0) speed *= 1.5;
                    p.x += data.dx * speed;
                    p.y += data.dy * speed;
                    p.anim += 0.3;
                    
                    if(p.x < 50) p.x = 50; if(p.y < 50) p.y = 50;
                    if(p.x > MAP_SIZE - 50) p.x = MAP_SIZE - 50; if(p.y > MAP_SIZE - 50) p.y = MAP_SIZE - 50;
                }
            }
            
            if(data.type === 'action' && p) {
                if(data.action === 'web' && (p.web > 0 || p.r >= 200)) { if(p.r < 200) p.web--; }
                if(data.action === 'rope' && (p.rope > 0 || p.r >= 200)) { if(p.r < 200) p.rope--; }
            }
            if (data.type === 'emoji' && p) { p.emoji = data.index; p.emojiTimer = 300; }
            if (data.type === 'respawn' && p) {
                p.dead = false; p.hp = 100; p.x = Math.random()*3000+1000; p.y = Math.random()*3000+1000;
            }

        } catch(e) {}
    });

    ws.on('close', () => {
        let l = lobbies[ws.lobbyIndex];
        if(l) { delete l.players[id]; delete l.sockets[id]; }
    });
});

// GAME LOOP - REDUCED TO 20 FPS FOR LESS LAG
setInterval(() => {
    lobbies.forEach(lobby => {
        let pack = [];
        if(lobby.items.length < 50) lobby.spawnItem();

        for (let id in lobby.players) {
            let p = lobby.players[id];
            if(p.emojiTimer > 0) p.emojiTimer--; else p.emoji = null;
            if(p.spdTime > 0) p.spdTime--;
            if(p.shdTime > 0) p.shdTime--;

            if (!p.dead) {
                // Item Collision
                for (let i = lobby.items.length - 1; i >= 0; i--) {
                    let it = lobby.items[i];
                    if (Math.hypot(p.x - it.x, p.y - it.y) < p.r + 30) {
                        lobby.items.splice(i, 1);
                        if(it.t === 0) { p.hp = Math.min(p.maxHp, p.hp+30); p.r += 2; }
                        if(it.t === 1) p.spdTime = 300; 
                        if(it.t === 2) p.shdTime = 300;
                        if(it.t === 3) p.web += 5;
                        if(it.t === 4) p.rope += 2;
                    }
                }
                
                // Player Combat
                for (let oid in lobby.players) {
                    if (id === oid) continue;
                    let o = lobby.players[oid];
                    if (o.dead || o.shdTime > 0) continue;
                    if (Math.hypot(p.x - o.x, p.y - o.y) < p.r && p.r > o.r * 1.2) {
                        o.dead = true;
                        p.r = Math.min(300, p.r + o.r * 0.4);
                        p.kills++;
                    }
                }
            }
            pack.push(p);
        }

        const msg = JSON.stringify({ type: 'update', players: pack, items: lobby.items });
        for (let id in lobby.sockets) {
            if (lobby.sockets[id].readyState === WebSocket.OPEN) lobby.sockets[id].send(msg);
        }
    });
}, 1000 / 20); // CHANGED 60 TO 20
