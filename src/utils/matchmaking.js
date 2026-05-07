import { ref, set, onValue, push, remove, get, update, onDisconnect } from 'firebase/database'
import { db } from '../firebase'

const GAME_LOBBY_PATHS = {
  'rps-tactic': 'lobby/rps-tactic',
  'pictionary': 'lobby/pictionary',
  'memory': 'lobby/memory',
  'finish-sentence': 'lobby/finish-sentence',
}

const GAME_ROOM_PATHS = {
  'rps-tactic': 'rps-rooms',
  'pictionary': 'pictionary-rooms',
  'memory': 'memory-rooms',
  'finish-sentence': 'sentence-rooms',
}

export function getLobbyPath(gameId) {
  return GAME_LOBBY_PATHS[gameId]
}

export function getRoomPath(gameId) {
  return GAME_ROOM_PATHS[gameId]
}

export async function joinLobby(gameId, playerId, playerName) {
  const lobbyPath = getLobbyPath(gameId)
  if (!lobbyPath) return null

  const lobbyRef = ref(db, lobbyPath)
  const snapshot = await get(lobbyRef)

  if (snapshot.exists()) {
    const lobby = snapshot.val()
    const waitingPlayers = Object.entries(lobby).filter(
      ([id, data]) => id !== playerId && Date.now() - data.timestamp < 60000 && !data.match
    )

    if (waitingPlayers.length > 0) {
      const [matchedPlayerId, matchedPlayerData] = waitingPlayers[0]

      await remove(ref(db, `${lobbyPath}/${playerId}`))

      return {
        matched: true,
        playerId: matchedPlayerId,
        playerName: matchedPlayerData.name,
      }
    }
  }

  await set(ref(db, `${lobbyPath}/${playerId}`), {
    name: playerName,
    timestamp: Date.now(),
  })

  const playerLobbyRef = ref(db, `${lobbyPath}/${playerId}`)
  onDisconnect(playerLobbyRef).remove()

  return { matched: false }
}

export async function leaveLobby(gameId, playerId) {
  const lobbyPath = getLobbyPath(gameId)
  if (!lobbyPath) return
  await remove(ref(db, `${lobbyPath}/${playerId}`))
}

export async function setLobbyMatch(gameId, waitingPlayerId, matchData) {
  const lobbyPath = getLobbyPath(gameId)
  if (!lobbyPath) return
  await update(ref(db, `${lobbyPath}/${waitingPlayerId}`), {
    match: matchData,
    matchTimestamp: Date.now(),
  })
}

export function listenForLobbyMatch(gameId, playerId, onMatch) {
  const lobbyPath = getLobbyPath(gameId)
  if (!lobbyPath) return () => {}

  const lobbyRef = ref(db, lobbyPath)
  const unsubscribe = onValue(lobbyRef, (snapshot) => {
    if (!snapshot.exists()) return
    const lobby = snapshot.val()
    const selfEntry = lobby[playerId]
    if (!selfEntry) return

    if (selfEntry.match && selfEntry.match.roomId) {
      onMatch(selfEntry.match)
      return
    }

    const waitingPlayers = Object.entries(lobby).filter(
      ([id, data]) => id !== playerId && Date.now() - data.timestamp < 60000 && !data.match
    )
    if (waitingPlayers.length > 0) {
      onMatch({
        playerId: waitingPlayers[0][0],
        playerName: waitingPlayers[0][1].name,
      })
    }
  })
  return unsubscribe
}

export function listenForPlayerCount(gameId, onCount) {
  const lobbyPath = getLobbyPath(gameId)
  const roomPath = getRoomPath(gameId)
  if (!lobbyPath || !roomPath) return () => {}

  let lobbyCount = 0
  let roomCount = 0

  const updateTotal = () => {
    onCount(lobbyCount + roomCount)
  }

  const lobbyRef = ref(db, lobbyPath)
  const lobbyUnsub = onValue(lobbyRef, (snapshot) => {
    if (snapshot.exists()) {
      const lobby = snapshot.val()
      lobbyCount = Object.values(lobby).filter(
        (data) => Date.now() - data.timestamp < 60000 && !data.match
      ).length
    } else {
      lobbyCount = 0
    }
    updateTotal()
  })

  const roomRef = ref(db, roomPath)
  const roomUnsub = onValue(roomRef, (snapshot) => {
    if (snapshot.exists()) {
      const rooms = snapshot.val()
      roomCount = Object.values(rooms).filter(
        (room) => room.status === 'playing' || room.status === 'waiting'
      ).length * 2
    } else {
      roomCount = 0
    }
    updateTotal()
  })

  return () => {
    lobbyUnsub()
    roomUnsub()
  }
}

export async function createRoomWithGuest(gameId, roomId, roomData) {
  const roomPath = getRoomPath(gameId)
  await set(ref(db, `${roomPath}/${roomId}`), roomData)
}
