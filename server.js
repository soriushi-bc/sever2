const WebSocket = require('ws');

const server = new WebSocket.Server({ port: 8080 });

const users = new Map();
const claims = new Map();
const roles = new Map();
const isDead = new Map();
let actualKingName = null;
let traitorKillCount = 0;

function generateRoles(n, useJoker) {
    let r = [];
    if (n === 4) r = ["K","Q","J","A"];
    if (n === 5) r = ["K","Q","J","J","A"];
    if (n === 6) r = useJoker ? ["K","Q","J","J","A","joker"] : ["K","Q","Q","J","J","A"];
    if (n === 7) r = useJoker ? ["K","Q","Q","J","J","A","joker"] : ["K","Q","Q","J","J","J","A"];
    if (n === 8) r = useJoker ? ["K","Q","Q","J","J","J","A","joker"] : ["K","Q","Q","J","J","J","A","A"];
    if (n === 9) r = useJoker ? ["K","Q","Q","J","J","J","A","A","joker"] : ["K","Q","Q","Q","J","J","J","A","A"];
    if (n === 10) r = useJoker ? ["K","Q","Q","J","J","J","A","A","joker","joker"] : ["K","Q","Q","Q","J","J","J","A","A","A"];
    return r;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

server.on('connection', ws => {

    console.log("有人連線");

    ws.on('message', msg => {

        const data = JSON.parse(msg);

        if (data.type === 'join') {

            const nameTaken = [...users.values()].includes(data.name);
            
            if (nameTaken) {
                ws.send(JSON.stringify({ type: 'error', message: '名字已被使用' }));
                return;
            }

            users.set(ws, data.name);

            claims.set(data.name, 'none');

            broadcastUsers();
        }
        
        if (data.type === 'claim') { 
            claims.set(data.name, data.role);
            broadcastUsers();
        }

        if (data.type === 'start') {
            const userList = [...users.entries()]; 
            const n = userList.length;
            const deck = shuffle(generateRoles(n, data.useJoker));

            console.log('人數：', n);  
            console.log('牌組：', deck);
            console.log('useJoker：', data.useJoker); 
                
            roles.clear();
            isDead.clear();
            traitorKillCount = 0;

            userList.forEach(([clientWs, name], i) => {
                roles.set(name, deck[i]);
                isDead.set(name, false);

                if (deck[i] === 'K') actualKingName = name;

                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                        type: 'your_role',
                        role: deck[i]
                    }));
                }
            });
        }

        if (data.type === 'dead') {
            const deadName = data.name;
            const deadRole = roles.get(deadName);
            isDead.set(deadName, true);

            broadcastUsers();

            // 小丑判定
            const allNames = [...users.values()];
            const jokers = allNames.filter(n => roles.get(n) === 'joker');
            const deadJokers = jokers.filter(n => isDead.get(n));
            if (jokers.length > 0 && jokers.length === deadJokers.length) {
                broadcast({ type: 'gameover', message: '🤡 所有小丑皆已陣亡，【小丑獲勝】！' });
                return;
            }

            // 國王陣亡
            if (deadName === actualKingName) {
                broadcast({ type: 'choose_heir', message: '👑 國王駕崩！請國王選擇繼承人。' });
                return;
            }

            checkOtherConditions(deadName);
        }

        if (data.type === 'heir') {
            const heirName = data.heirName;
            const heirRole = roles.get(heirName);

            if (heirRole === 'J') {
                broadcast({ type: 'gameover', message: `繼承人 ${heirName} 是【反賊】！⚔️ 反賊篡位成功，【反賊獲勝】！` });
            } else if (heirRole === 'A') {
                broadcast({ type: 'gameover', message: `繼承人 ${heirName} 是【內奸】！🗡️ 內奸竊國成功，【內奸獲勝】！` });
            } else {
                actualKingName = heirName;
                broadcast({ type: 'new_king', message: `👑 ${heirName} 登基成為新任國王！` });
            }
        }

        function checkOtherConditions(deadName) {
            const deadRole = roles.get(deadName);
            const allNames = [...users.values()];

            // 內奸判定
            if (['K','Q','J'].includes(deadRole)) {
                const hasAliveTraitor = allNames.some(n => roles.get(n) === 'A' && !isDead.get(n));
                if (hasAliveTraitor) {
                    traitorKillCount++;
                    if (traitorKillCount >= 3) {
                        broadcast({ type: 'gameover', message: '🗡️ 內奸已成功刺殺三名目標，【內奸獲勝】！' });
                        return;
                    } else {
                        broadcast({ type: 'info', message: `目前內奸擊殺進度：${traitorKillCount}/3` });
                    }
                }
            }

            // 反賊全滅判定
            const rebels = allNames.filter(n => roles.get(n) === 'J');
            const deadRebels = rebels.filter(n => isDead.get(n));
            if (rebels.length > 0 && rebels.length === deadRebels.length) {
                broadcast({ type: 'gameover', message: '🛡️ 所有反賊皆已伏誅，【國王與忠臣獲勝】！' });
            }
        }

        function broadcast(obj) {
            server.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(obj));
                }
            });
        }
    
    });

    ws.on('close', () => {
        const name = users.get(ws);
        
        users.delete(ws);
        claims.delete(name);

        broadcastUsers();
    });
});

function broadcastUsers() {

    const userList = [...users.values()].map(name => ({
        name,
        role: claims.get(name) || 'none',
        dead: isDead.get(name) || false
    }));

    server.clients.forEach(client => {

        if (client.readyState === WebSocket.OPEN) {

            client.send(JSON.stringify({
                type: 'users',
                users: userList
            }));
        }
    });
}

console.log('WebSocket server running');
