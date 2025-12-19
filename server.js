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
        this.projectiles = [];
        this.sockets = {};
        this.itemCounter = 0;
        this.projCounter = 0;
        this.tick = 0; // For timing updates
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
            x: Math.floor(Math.random() * (MAP_SIZE - 200) + 100),
            y: Math.floor(Math.random() * (MAP_SIZE - 200) + 100),
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
                    angle: 0, anim: 0, atk: false, dead: false, emoji: null,
                    hp: 100, maxHp: 100, web: 0, rope: 0, spdTime: 0, shdTime: 0, stun: 0,
                    ropeTargetId: null, ropeState: 0
                };
                // Send Init (and force item load)
                ws.send(JSON.stringify({ type:'init', id:id, x:myLobby.players[id].x, y:myLobby.players[id].y, items:myLobby.items }));
            }

            if (data.type === 'move' && p && !p.dead) {
                p.atk = data.atk;
                if(p.stun <= 0) {
                    if(data.dx || data.dy) {
                        p.angle = Math.atan2(data.dy, data.dx);
                        let speed = Math.max(4, 8 - (p.r-60)*0.01);
                        if(p.spdTime > 0) speed *= 1.5;
                        p.x += data.dx * speed;
                        p.y += data.dy * speed;
                        p.anim += 0.3;
                        
                        // Hard Wall
                        p.x = Math.max(60, Math.min(MAP_SIZE-60, p.x));
                        p.y = Math.max(60, Math.min(MAP_SIZE-60, p.y));
                    }
                }
            }
            
            if(data.type === 'action' && p && !p.dead && p.stun <= 0) {
                if(data.action === 'web') {
                    if (p.web > 0 || p.r >= 200) {
                        if(p.r < 200) p.web--;
                        myLobby.projectiles.push({
                            id: myLobby.projCounter++, type: 'web', owner: id,
                            x: Math.floor(p.x), y: Math.floor(p.y), 
                            vx: Math.cos(p.angle) * 25, vy: Math.sin(p.angle) * 25,
                            life: 45 // 3 sec at 15 TPS
                        });
                    }
                }
                if(data.action === 'rope') {
                    if(p.ropeTargetId) { p.ropeTargetId = null; p.ropeState = 0; } 
                    else if (p.rope > 0 || p.r >= 200) {
                        if(p.r < 200) p.rope--;
                        myLobby.projectiles.push({
                            id: myLobby.projCounter++, type: 'rope', owner: id,
                            x: Math.floor(p.x), y: Math.floor(p.y), 
                            vx: Math.cos(p.angle) * 30, vy: Math.sin(p.angle) * 30,
                            life: 30
                        });
                        ws.send(JSON.stringify({ type: 'cooldown', skill: 'rope' }));
                    }
                }
            }

            if (data.type === 'emoji' && p) p.emoji = data.index;
            if (data.type === 'respawn' && p) {
                p.dead = false; p.hp = 100; p.x = Math.random()*3000+1000; p.y = Math.random()*3000+1000; p.stun=0;
            }

        } catch(e) {}
    });

    ws.on('close', () => {
        let l = lobbies[ws.lobbyIndex];
        if(l) { delete l.players[id]; delete l.sockets[id]; }
    });
});

// GAME LOOP - 15 TPS (Low Latency)
setInterval(() => {
    lobbies.forEach(lobby => {
        lobby.tick++;
        let sendItems = (lobby.tick % 30 === 0); // Send items ONLY every 2 seconds
        let pack = [];
        
        if(lobby.items.length < 50) lobby.spawnItem();

        // Projectiles
        for(let i=lobby.projectiles.length-1; i>=0; i--) {
            let proj = lobby.projectiles[i];
            proj.x += proj.vx; proj.y += proj.vy; proj.life--;
            
            for(let pid in lobby.players) {
                let hitP = lobby.players[pid];
                if(hitP.dead || pid === proj.owner) continue;
                if(Math.hypot(proj.x - hitP.x, proj.y - hitP.y) < hitP.r) {
                    if(proj.type === 'web') hitP.stun = 75; // 5 Secs
                    if(proj.type === 'rope') {
                        let owner = lobby.players[proj.owner];
                        if(owner) { owner.ropeTargetId = pid; owner.ropeState = 1; }
                    }
                    proj.life = 0; break;
                }
            }
            if(proj.life <= 0) lobby.projectiles.splice(i, 1);
        }

        // Players
        for (let id in lobby.players) {
            let p = lobby.players[id];
            if(p.stun > 0) p.stun--;
            if(p.spdTime > 0) p.spdTime--;
            if(p.shdTime > 0) p.shdTime--;

            if (!p.dead) {
                // Ropes
                if(p.ropeTargetId) {
                    let target = lobby.players[p.ropeTargetId];
                    if(!target || target.dead) p.ropeTargetId = null; 
                    else {
                        let angle = Math.atan2(target.y - p.y, target.x - p.x);
                        let dist = Math.hypot(target.x - p.x, target.y - p.y);
                        if(dist > p.r + target.r) {
                            let pull = 15;
                            if(p.r > target.r) { target.x -= Math.cos(angle)*pull; target.y -= Math.sin(angle)*pull; }
                            else if (p.r < target.r) { p.x += Math.cos(angle)*pull; p.y += Math.sin(angle)*pull; }
                            else { 
                                p.x += Math.cos(angle)*(pull/2); p.y += Math.sin(angle)*(pull/2);
                                target.x -= Math.cos(angle)*(pull/2); target.y -= Math.sin(angle)*(pull/2);
                            }
                        } else {
                            if(target.r < p.r) target.stun = 45; // 3 sec stun
                            p.ropeTargetId = null;
                        }
                    }
                }

                // Items (NO MASS GAIN)
                for (let i = lobby.items.length - 1; i >= 0; i--) {
                    let it = lobby.items[i];
                    if (Math.hypot(p.x - it.x, p.y - it.y) < p.r + 30) {
                        lobby.items.splice(i, 1);
                        if(it.t === 0) p.hp = Math.min(p.maxHp, p.hp+30); // HP only
                        if(it.t === 1) p.spdTime = 75; // 5s Speed
                        if(it.t === 2) p.shdTime = 75; // 5s Shield
                        if(it.t === 3) p.web += 3;
                        if(it.t === 4) p.rope += 1;
                    }
                }
                
                // Combat (GROWTH HERE ONLY)
                for (let oid in lobby.players) {
                    if (id === oid) continue;
                    let o = lobby.players[oid];
                    if (o.dead || o.shdTime > 0) continue;
                    
                    if (Math.hypot(p.x - o.x, p.y - o.y) < p.r && p.r > o.r * 1.2) {
                        o.dead = true;
                        p.r = Math.min(300, p.r + o.r * 0.4); // GROW
                        p.kills++;
                        p.hp = Math.min(p.maxHp, p.hp + 50);
                    }
                }
            }
            
            // Round Integers for Bandwidth
            p.x = Math.round(p.x); p.y = Math.round(p.y);
            pack.push(p);
        }

        const msg = JSON.stringify({ 
            type: 'update', 
            players: pack, 
            items: sendItems ? lobby.items : null, // OPTIMIZATION: Only send items sometimes
            projs: lobby.projectiles 
        });
        
        for (let id in lobby.sockets) {
            if (lobby.sockets[id].readyState === WebSocket.OPEN) lobby.sockets[id].send(msg);
        }
    });
}, 1000 / 15); // 15 TPS
