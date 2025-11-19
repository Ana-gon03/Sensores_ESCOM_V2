// server.js
// Archivo principal del servidor WebSocket
const express = require("express");
const { WebSocketServer } = require("ws");
const path = require("path");

// Importar módulos para el juego de zombies
const {
    isValidMove,
    calculateDistance,
    moveZombieTowardsPlayer,
    moveZombieRandomly,
    isPlayerCaught
} = require('./zombieController');

const app = express();
const PORT = 3000;

const server = app.listen(PORT, () => {
    console.log(`Server running on http://192.168.1.81:${PORT}`);
});

const wss = new WebSocketServer({ server });

const POSITION_THRESHOLD = 1;
const UPDATE_INTERVAL = 50;

const players = {};
const lastUpdateTime = {};

function generateRandomColor() {
    return '#' + Math.floor(Math.random()*16777215).toString(16);
}

function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    });
}

function shouldUpdate(playerId) {
    const currentTime = Date.now();
    if (!lastUpdateTime[playerId] || currentTime - lastUpdateTime[playerId] >= UPDATE_INTERVAL) {
        lastUpdateTime[playerId] = currentTime;
        return true;
    }
    return false;
}

function hasPositionChangedSignificantly(oldPos, newPos) {
    if (!oldPos) return true;
    return oldPos.x !== newPos.x || oldPos.y !== newPos.y;
}

function processPosition(data) {
    // Si es una actualización simple
    if (typeof data.x === "number" && typeof data.y === "number") {
        return {
            local: { x: data.x, y: data.y }
        };
    }
    // Si es una actualización con posiciones local y remota
    if (data.local || data.remote) {
        return {
            local: data.local || null,
            remote: data.remote || null
        };
    }
    return null;
}

// Estado del zombie
const zombieGame = {
    zombies: [],
    isActive: false,
    difficulty: 1,
    currentMap: "escom_cafeteria",
    lastUpdateTimes: {},  // Para controlar la frecuencia de actualización
    updateIntervals: {
        1: 1200,  // Fácil: 1.2 segundos
        2: 800,   // Medio: 0.8 segundos
        3: 500    // Difícil: 0.5 segundos
    },
    zombieCount: {
        1: 2,  // Fácil: 2 zombies
        2: 4,  // Medio: 4 zombies
        3: 6   // Difícil: 6 zombies
    }
};

function initializeZombieGame() {
    zombieGame.zombies = [];
    zombieGame.isActive = false;
    zombieGame.difficulty = 1;
    zombieGame.currentMap = "escom_cafeteria";
    zombieGame.lastUpdateTimes = {};
    console.log("Estado del juego zombie inicializado:", zombieGame);
}

// Función para sincronizar zombies con todos los clientes
function syncZombiesWithAllClients() {
    if (!zombieGame.isActive) return;

    // Enviar estado completo de zombies a todos los clientes
    const zombieData = zombieGame.zombies.map(zombie => ({
        id: zombie.id,
        x: zombie.position.x,
        y: zombie.position.y,
        difficulty: zombie.difficulty
    }));

    broadcast({
        type: "zombie_position_batch", // 🔥 NUEVO TIPO DE MENSAJE
        zombies: zombieData,
        map: zombieGame.currentMap,
        difficulty: zombieGame.difficulty,
        timestamp: Date.now() // Para sincronización temporal
    });

    console.log(`📡 Sincronizando ${zombieGame.zombies.length} zombies con todos los clientes`);
}

// Función para enviar comando de inicio a todos los clientes
function broadcastZombieGameStart(difficulty, mapName) {
    const zombiesData = zombieGame.zombies.map(zombie => ({
        id: zombie.id,
        x: zombie.position.x,
        y: zombie.position.y,
        difficulty: zombie.difficulty
    }));

    broadcast({
        type: "zombie_game_command",
        command: "start",
        difficulty: difficulty,
        map: mapName,
        zombies: zombiesData // 🔥 ENVIAR ZOMBIES EN EL COMANDO DE INICIO
    });
    console.log(`🚀 Enviando comando de inicio con ${zombiesData.length} zombies a todos los clientes`);
}

// Intervalo de actualización del zombie
let zombieUpdateInterval = null;

// Función para iniciar el minijuego del zombie
function startZombieGame(difficulty = 1, mapName = "escom_cafeteria") {
    console.log(`🎮 EJECUTANDO startZombieGame: dificultad=${difficulty}, mapa=${mapName}`);

    // Si el juego ya está activo, no hacer nada
    if (zombieGame.isActive) {
        console.log("🔄 El juego zombie ya está activo, sincronizando con nuevo cliente...");
        syncZombiesWithAllClients();
        return;
    }

    zombieGame.isActive = true;
    zombieGame.difficulty = difficulty;
    zombieGame.currentMap = mapName;

    // Crear zombies según la dificultad
    const zombieCount = zombieGame.zombieCount[difficulty] || 2;
    console.log(`🧟 Creando ${zombieCount} zombies para dificultad ${difficulty}`);

    // Limpiar zombies existentes
    zombieGame.zombies = [];

    // Función auxiliar para encontrar una posición válida
    const findValidPosition = (attempt = 0) => {
        if (attempt > 100) {
            console.warn('No se pudo encontrar posición válida, usando por defecto');
            return { x: 20, y: 15 };
        }

        const x = Math.floor(Math.random() * 35) + 2;
        const y = Math.floor(Math.random() * 35) + 2;

        if (isValidMove(x, y, mapName)) {
            return { x, y };
        }

        return findValidPosition(attempt + 1);
    };

    // Crear nuevos zombies con posiciones validadas
    for (let i = 0; i < zombieCount; i++) {
        const position = findValidPosition();

        zombieGame.zombies.push({
            id: `zombie_${i}`,
            position: { x: position.x, y: position.y },
            target: null,
            difficulty: difficulty
        });

        console.log(`✅ Zombie ${i} creado en posición VÁLIDA: (${position.x}, ${position.y})`);
    }

    // Notificar a TODOS los clientes que el juego ha iniciado
    console.log(`📢 Enviando comando de inicio a todos los clientes`);
    broadcastZombieGameStart(difficulty, mapName);

    // Iniciar la actualización periódica
    startZombieUpdates();

    console.log(`🎮 Minijuego zombie INICIADO para MULTIPLAYER con dificultad ${difficulty} en mapa ${mapName}`);
    console.log(`📊 Estado actual: ${zombieGame.zombies.length} zombies activos`);
}

// Función para detener el minijuego del zombie
function stopZombieGame() {
    console.log("🛑 Deteniendo minijuego zombie");
    zombieGame.isActive = false;

    // Detener todas las actualizaciones
    if (zombieUpdateInterval) {
        clearInterval(zombieUpdateInterval);
        zombieUpdateInterval = null;
    }

    // Notificar a todos los clientes
    broadcast({
        type: "zombie_game_command",
        command: "stop"
    });

    console.log("Minijuego zombie detenido");
}

// Función para iniciar las actualizaciones periódicas del zombie
function startZombieUpdates() {
    // Detener intervalo existente si hay
    if (zombieUpdateInterval) {
        clearInterval(zombieUpdateInterval);
    }

    // El intervalo de actualización depende de la dificultad
    const updateInterval = zombieGame.updateIntervals[zombieGame.difficulty] || 1000;
    console.log(`⏰ Iniciando actualizaciones de zombies cada ${updateInterval}ms`);

    // Crear nuevo intervalo
    zombieUpdateInterval = setInterval(() => {
        if (zombieGame.isActive) {
            updateZombiePositions();
        } else {
            clearInterval(zombieUpdateInterval);
            zombieUpdateInterval = null;
        }
    }, updateInterval);
}

// Función para actualizar la posición del zombie
function updateZombiePositions() {
    if (!zombieGame.isActive) return;

    // Buscar jugadores en el mapa actual del juego zombie
    const playersInMap = Object.entries(players).filter(([id, data]) => {
        return data.currentMap === zombieGame.currentMap;
    });

    if (playersInMap.length === 0) {
        // Si no hay jugadores, los zombies se mueven aleatoriamente
        zombieGame.zombies.forEach(zombie => {
            moveZombieRandomly(zombie, zombieGame.currentMap);
        });
    } else {
        // Actualizar cada zombie
        zombieGame.zombies.forEach(zombie => {
            // Encontrar el jugador más cercano
            let nearestPlayer = null;
            let shortestDistance = Infinity;

            playersInMap.forEach(([playerId, playerData]) => {
                const distance = calculateDistance(
                    zombie.position.x, zombie.position.y,
                    playerData.x, playerData.y
                );

                if (distance < shortestDistance) {
                    shortestDistance = distance;
                    nearestPlayer = { id: playerId, data: playerData };
                }
            });

            if (nearestPlayer) {
                // Asignar objetivo
                zombie.target = nearestPlayer.id;
                // Mover hacia el jugador
                moveZombieTowardsPlayer(zombie, nearestPlayer.data, zombieGame.currentMap);

                // Verificar colisión
                if (isPlayerCaught(zombie, nearestPlayer.data)) {
                    broadcast({
                        type: "zombie_game_command",
                        command: "caught",
                        player: nearestPlayer.id
                    });
                    console.log(`🎯 Zombie ${zombie.id} atrapó al jugador ${nearestPlayer.id}`);
                }
            } else {
                // Si no encontramos jugador, mover aleatoriamente
                moveZombieRandomly(zombie, zombieGame.currentMap);
            }
        });
    }

    // 🔥 IMPORTANTE: Sincronizar posiciones con TODOS los clientes después de cada actualización
    syncZombiesWithAllClients();
}

const caughtPlayers = new Set();

// Verificar si el zombie ha atrapado a algún jugador
function checkZombieCollisions() {
    const catchDistance = 2; // Distancia para considerar que ha atrapado a un jugador

    Object.entries(players).forEach(([playerId, playerData]) => {
        if (playerData.currentMap === zombieGame.currentMap && !caughtPlayers.has(playerId)) {
            // Recorre todos los zombies y verifica colisiones con cada uno
            zombieGame.zombies.forEach(zombie => {
                const distanceX = Math.abs(zombie.position.x - playerData.x);
                const distanceY = Math.abs(zombie.position.y - playerData.y);

                if (distanceX <= catchDistance && distanceY <= catchDistance) {
                    // Añadir a la lista de atrapados para evitar mensajes duplicados
                    caughtPlayers.add(playerId);

                    // Enviar mensaje al jugador que ha sido atrapado
                    broadcast({
                        type: "zombie_game_command",
                        command: "caught",
                        player: playerId
                    });

                    console.log(`Zombie atrapó al jugador ${playerId} en posición (${playerData.x}, ${playerData.y})`);

                    // Limpiar después de un tiempo para permitir que el jugador sea atrapado de nuevo
                    setTimeout(() => {
                        caughtPlayers.delete(playerId);
                    }, 5000);
                }
            });
        }
    });
}

// Procesar mensajes relacionados con el minijuego del zombie
function processZombieGameMessages(message) {
    console.log(`🎮 Procesando mensaje del juego zombie: ${message.type} - ${message.action}`);

    if (message.type === "zombie_game_update") {
        const action = message.action;

        switch (action) {
            case "start":
                console.log(`🚀 Solicitando inicio del juego zombie por ${message.player}`);
                const difficulty = message.difficulty || 1;
                const mapName = message.map || "escom_cafeteria";

                if (!zombieGame.isActive) {
                    console.log(`🎯 Iniciando juego zombie en mapa ${mapName} con dificultad ${difficulty}`);
                    startZombieGame(difficulty, mapName);
                } else {
                    console.log(`ℹ️ El juego zombie ya está activo, sincronizando...`);
                    syncZombiesWithAllClients();
                }
                break;

            case "stop":
                console.log(`🛑 Solicitando detener el juego zombie por ${message.player}`);
                if (zombieGame.isActive) {
                    stopZombieGame();
                }
                break;

            case "complete":
                // Un jugador ha completado el minijuego
                if (zombieGame.isActive) {
                    // Notificar a todos los clientes
                    broadcast({
                        type: "zombie_game_update",
                        action: "player_result",
                        player: message.player,
                        survived: message.survived,
                        time: message.time,
                        score: message.score
                    });

                    console.log(`Jugador ${message.player} completó el minijuego: ${message.survived ? 'Sobrevivió' : 'Atrapado'}, Puntuación: ${message.score}`);
                }
                break;

            default:
                console.log(`❌ Acción desconocida del juego zombie: ${action}`);
        }
    } else if (message.type === "zombie_game_food") {
        // Un jugador ha recogido comida - ralentizar a todos los zombies
        console.log(`🍎 ${message.player} recogió comida, ralentizando zombies`);

        broadcast({
            type: "zombie_game_food",
            player: message.player,
            score: message.score,
            x: message.x,
            y: message.y
        });

        // Aumentar temporalmente el intervalo de actualización (más lento)
        const oldInterval = zombieGame.updateIntervals[zombieGame.difficulty];
        const newInterval = oldInterval + 300; // 300ms más lento

        // Detener intervalo actual
        if (zombieUpdateInterval) {
            clearInterval(zombieUpdateInterval);
        }

        // Crear nuevo intervalo más lento
        zombieUpdateInterval = setInterval(() => {
            if (zombieGame.isActive) {
                updateZombiePositions();
            } else {
                clearInterval(zombieUpdateInterval);
                zombieUpdateInterval = null;
            }
        }, newInterval);

        // Notificar ralentización
        broadcast({
            type: "zombie_game_command",
            command: "zombie_slowed",
            player: message.player
        });

        // Restaurar velocidad después de 3 segundos
        setTimeout(() => {
            // Solo restaurar si el juego sigue activo
            if (zombieGame.isActive && zombieUpdateInterval) {
                // Detener intervalo actual
                clearInterval(zombieUpdateInterval);

                // Crear nuevo intervalo con velocidad normal
                zombieUpdateInterval = setInterval(() => {
                    if (zombieGame.isActive) {
                        updateZombiePositions();
                    } else {
                        clearInterval(zombieUpdateInterval);
                        zombieUpdateInterval = null;
                    }
                }, oldInterval);

                // Notificar a los clientes
                broadcast({
                    type: "zombie_game_command",
                    command: "zombie_speed_normal"
                });
            }
        }, 3000);
    } else {
        console.log(`❌ Tipo de mensaje zombie desconocido: ${message.type}`);
    }
}

wss.on("connection", (ws) => {
    console.log("A player connected");
    initializeZombieGame(); // Inicializar el estado del juego zombie

    // Si el juego zombie ya está activo, sincronizar con el nuevo cliente
    if (zombieGame.isActive) {
        setTimeout(() => {
            console.log("🔄 Sincronizando juego zombie existente con nuevo cliente");
            syncZombiesWithAllClients();
        }, 1000);
    }

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            // Si el mensaje es una actualización para el mapa global, convierte las coordenadas.
            if (data.type === 'update' && data.map === 'global') {
                if (typeof data.x === 'number') data.x /= 1e6;
                if (typeof data.y === 'number') data.y /= 1e6;

                if (data.local) {
                    data.local.x /= 1e6;
                    data.local.y /= 1e6;
                }
                if (data.remote) {
                    data.remote.x /= 1e6;
                    data.remote.y /= 1e6;
                }
            }

            console.log("Received data:", JSON.stringify(data, null, 2));

            // 🔥 CORRECCIÓN: Procesar mensajes de zombie_game_update ANTES del switch
            if (data.type === "zombie_game_update" || data.type === "zombie_game_food") {
                processZombieGameMessages(data);
                return; // Salir después de procesar
            }

            const trimmedId = data.id?.trim();
            if (!trimmedId) return;

            switch (data.type) {
                case "join":
                    if (!players[trimmedId]) {
                        players[trimmedId] = {
                            x: 1,
                            y: 1,
                            currentMap: "main",
                            color: generateRandomColor(),
                            type: "local"
                        };
                        console.log(`Player joined: ${trimmedId}`);
                        // Informar al nuevo jugador sobre los jugadores existentes
                        ws.send(JSON.stringify({
                            type: "positions",
                            players: players
                        }));
                    }
                    break;

                case "update":
                    if (shouldUpdate(trimmedId)) {
                        const positions = processPosition(data);
                        const currentMap = data.map || "main";

                        if (positions) {
                            let hasChanges = false;

                            // Actualizar posición local
                            if (positions.local) {
                                const previousPosition = players[trimmedId];
                                if (hasPositionChangedSignificantly(previousPosition, positions.local)) {
                                    players[trimmedId] = {
                                        x: positions.local.x,
                                        y: positions.local.y,
                                        currentMap: currentMap,
                                        color: players[trimmedId]?.color || generateRandomColor(),
                                        type: "local"
                                    };
                                    hasChanges = true;
                                }
                            }

                            // Actualizar posición remota si existe
                            if (positions.remote) {
                                const remoteId = `${trimmedId}_remote`;
                                const previousRemotePosition = players[remoteId];
                                if (hasPositionChangedSignificantly(previousRemotePosition, positions.remote)) {
                                    players[remoteId] = {
                                        x: positions.remote.x,
                                        y: positions.remote.y,
                                        currentMap: currentMap,
                                        color: "#FF0000",
                                        type: "remote"
                                    };
                                    hasChanges = true;
                                }
                            }

                            if (hasChanges) {
                                // Enviar actualización a todos los clientes
                                const updateMessage = {
                                    type: "update",
                                    id: trimmedId,
                                    x: positions.local.x,
                                    y: positions.local.y,
                                    map: currentMap
                                };
                                broadcast(updateMessage);
                            }
                        }
                    }
                    break;

                case "leave":
                    if (players[trimmedId]) {
                        console.log(`Player left: ${trimmedId}`);
                        delete players[trimmedId];
                        delete players[`${trimmedId}_remote`];
                        delete lastUpdateTime[trimmedId];
                        broadcast({
                            type: "disconnect",
                            id: trimmedId
                        });
                    }
                    break;

                case "request_positions":
                    // Enviar posiciones actuales al cliente que las solicita
                    ws.send(JSON.stringify({
                        type: "positions",
                        players: players
                    }));
                    break;
            }
        } catch (error) {
            console.error("Error processing message:", error);
            console.error(error.stack);
        }
    });

    ws.on("close", () => {
        console.log("A player disconnected");
        // Buscar y eliminar el jugador desconectado
        Object.keys(players).forEach(playerId => {
            if (players[playerId].ws === ws) {
                delete players[playerId];
                delete players[`${playerId}_remote`];
                delete lastUpdateTime[playerId];
                broadcast({
                    type: "disconnect",
                    id: playerId
                });
            }
        });
    });
});

app.get("/", (req, res) => {
    res.json({
        message: "WebSocket server is running.",
        connectedPlayers: Object.keys(players).length,
        players: players
    });
});

// Limpieza de jugadores inactivos
setInterval(() => {
    const currentTime = Date.now();
    Object.keys(lastUpdateTime).forEach(playerId => {
        if (currentTime - lastUpdateTime[playerId] > 30000) { // 30 segundos de inactividad
            console.log(`Removing inactive player: ${playerId}`);
            delete players[playerId];
            delete players[`${playerId}_remote`];
            delete lastUpdateTime[playerId];
            broadcast({
                type: "disconnect",
                id: playerId
            });
        }
    });
}, 10000);

// Middleware para parsear JSON
app.use(express.json());

// Rutas administrativas para controlar el minijuego
app.post("/admin/zombie/start", (req, res) => {
    const difficulty = req.body.difficulty || 1;
    const mapName = req.body.map || "escom_cafeteria";
    startZombieGame(difficulty, mapName);
    res.json({ message: "Minijuego zombie iniciado", state: zombieGame });
});

app.post("/admin/zombie/stop", (req, res) => {
    stopZombieGame();
    res.json({ message: "Minijuego zombie detenido", state: zombieGame });
});

app.get("/admin/zombie/state", (req, res) => {
    res.json(zombieGame);
});

app.get("/admin/zombie/start-test", (req, res) => {
    startZombieGame(1);
    res.json({ message: "Minijuego zombie iniciado para pruebas", state: zombieGame });
});

app.get("/admin/zombie/list", (req, res) => {
    res.json({
        isActive: zombieGame.isActive,
        difficulty: zombieGame.difficulty,
        currentMap: zombieGame.currentMap,
        zombies: zombieGame.zombies,
        zombieCount: zombieGame.zombies.length
    });
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});