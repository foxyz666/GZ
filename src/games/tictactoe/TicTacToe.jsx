import { useState, useEffect, useRef, useCallback } from 'react'
import { ref, set, onValue, push, remove, get, update, onDisconnect } from 'firebase/database'
import { db } from '../../firebase'
import { joinLobby, leaveLobby, listenForLobbyMatch, setLobbyMatch } from '../../utils/matchmaking'
import { Grid3X3, RotateCcw, Search, User, Trophy, MessageSquare, Send } from 'lucide-react'

const GAME_ID = 'tictactoe'
const ROOMS_PATH = 'tictactoe-rooms'

const WIN_COMBINATIONS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
  [0, 4, 8], [2, 4, 6]             // Diagonals
]

export default function TicTacToe() {
  const [playerId] = useState(() => 'p_' + Math.random().toString(36).substr(2, 9))
  const [playerName, setPlayerName] = useState('')
  const [joined, setJoined] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [gameState, setGameState] = useState(null)
  const [searching, setSearching] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [message, setMessage] = useState('')

  const matchUnsubRef = useRef(null)

  const checkWinner = (board) => {
    for (const [a, b, c] of WIN_COMBINATIONS) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a]
      }
    }
    if (board.every(cell => cell !== null)) return 'draw'
    return null
  }

  const createRoom = async () => {
    if (!playerName.trim()) return
    const roomRef = push(ref(db, ROOMS_PATH))
    const newRoomId = roomRef.key
    const initialState = {
      status: 'waiting',
      host: playerId,
      hostName: playerName,
      guest: '',
      guestName: '',
      hostScore: 0,
      guestScore: 0,
      board: Array(9).fill(null),
      turn: playerId,
      winner: null,
      lastMoveAt: Date.now()
    }
    await set(roomRef, initialState)
    onDisconnect(roomRef).remove()
    setRoomId(newRoomId)
    setIsHost(true)
    setJoined(true)
  }

  const joinRoom = async () => {
    if (!playerName.trim() || !roomId.trim()) return
    const roomRef = ref(db, `${ROOMS_PATH}/${roomId}`)
    const snapshot = await get(roomRef)
    if (!snapshot.exists()) {
      alert('Camera nu exista!')
      return
    }
    const data = snapshot.val()
    if (data.guest) {
      alert('Camera este plina!')
      return
    }
    await update(ref(db, `${ROOMS_PATH}/${roomId}`), {
      guest: playerId,
      guestName: playerName,
      status: 'playing',
    })
    setJoined(true)
    setIsHost(false)
  }

  useEffect(() => {
    if (!joined || !roomId) return
    const roomRef = ref(db, `${ROOMS_PATH}/${roomId}`)
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val()
        if (!data.board) data.board = Array(9).fill(null)
        setGameState(data)
      } else {
        setGameState(null)
        if (joined) {
          alert('Cameră a fost închisă.')
          resetGame()
        }
      }
    })
    return () => unsubscribe()
  }, [joined, roomId])

  useEffect(() => {
    if (!joined || !roomId) return
    const chatRef = ref(db, `${ROOMS_PATH}/${roomId}/chat`)
    const unsubscribe = onValue(chatRef, (snapshot) => {
      if (snapshot.exists()) {
        setChatMessages(Object.values(snapshot.val()))
      } else {
        setChatMessages([])
      }
    })
    return () => unsubscribe()
  }, [joined, roomId])

  const makeMove = async (index) => {
    if (!gameState || gameState.status !== 'playing') return
    if (gameState.turn !== playerId) return
    if (gameState.board[index] || gameState.winner) return

    const newBoard = [...gameState.board]
    newBoard[index] = isHost ? 'X' : 'O'
    const winner = checkWinner(newBoard)

    const updates = {
      board: newBoard,
      lastMoveAt: Date.now()
    }

    if (winner) {
      updates.winner = winner
      if (winner === 'X') {
        updates.hostScore = (gameState.hostScore || 0) + 1
      } else if (winner === 'O') {
        updates.guestScore = (gameState.guestScore || 0) + 1
      }
    } else {
      updates.turn = isHost ? gameState.guest : gameState.host
    }

    await update(ref(db, `${ROOMS_PATH}/${roomId}`), updates)
  }

  const restartGame = async () => {
    if (!roomId) return
    await update(ref(db, `${ROOMS_PATH}/${roomId}`), {
      board: Array(9).fill(null),
      turn: gameState.host, // Host always starts for simplicity or toggle
      winner: null,
      status: 'playing'
    })
    await remove(ref(db, `${ROOMS_PATH}/${roomId}/chat`))
  }

  const sendMessage = async () => {
    if (!message.trim() || !roomId) return
    await push(ref(db, `${ROOMS_PATH}/${roomId}/chat`), {
      player: playerName,
      message: message,
      timestamp: Date.now()
    })
    setMessage('')
  }

  const cancelSearch = useCallback(() => {
    setSearching(false)
    leaveLobby(GAME_ID, playerId)
    if (matchUnsubRef.current) {
      matchUnsubRef.current()
      matchUnsubRef.current = null
    }
  }, [playerId])

  const findOnlinePlayer = useCallback(async () => {
    if (!playerName.trim()) return
    setSearching(true)
    const result = await joinLobby(GAME_ID, playerId, playerName)
    if (result.matched) {
      setSearching(false)
      const roomRef = push(ref(db, ROOMS_PATH))
      const newRoomId = roomRef.key
      const initialState = {
        status: 'playing',
        host: playerId,
        hostName: playerName,
        guest: result.playerId,
        guestName: result.playerName,
        hostScore: 0,
        guestScore: 0,
        board: Array(9).fill(null),
        turn: playerId,
        winner: null,
        lastMoveAt: Date.now()
      }
      await set(roomRef, initialState)
      await setLobbyMatch(GAME_ID, result.playerId, {
        roomId: newRoomId,
        host: playerId,
        hostName: playerName,
        guest: result.playerId,
        guestName: result.playerName,
      })
      setRoomId(newRoomId)
      setIsHost(true)
      setJoined(true)
    } else {
      matchUnsubRef.current = listenForLobbyMatch(GAME_ID, playerId, async (matched) => {
        if (!matched) return
        if (matched.roomId) {
          setSearching(false)
          if (matchUnsubRef.current) {
            matchUnsubRef.current()
            matchUnsubRef.current = null
          }
          await leaveLobby(GAME_ID, playerId)
          setRoomId(matched.roomId)
          setIsHost(playerId === matched.host)
          setJoined(true)
          return
        }

        if (playerId > matched.playerId) return

        setSearching(false)
        if (matchUnsubRef.current) {
          matchUnsubRef.current()
          matchUnsubRef.current = null
        }
        await leaveLobby(GAME_ID, playerId)
        const roomRef = push(ref(db, ROOMS_PATH))
        const newRoomId = roomRef.key
        const initialState = {
          status: 'playing',
          host: playerId,
          hostName: playerName,
          guest: matched.playerId,
          guestName: matched.playerName,
          hostScore: 0,
          guestScore: 0,
          board: Array(9).fill(null),
          turn: playerId,
          winner: null,
          lastMoveAt: Date.now()
        }
        await set(roomRef, initialState)
        await setLobbyMatch(GAME_ID, matched.playerId, {
          roomId: newRoomId,
          host: playerId,
          hostName: playerName,
          guest: matched.playerId,
          guestName: matched.playerName,
        })
        setRoomId(newRoomId)
        setIsHost(true)
        setJoined(true)
      })
    }
  }, [playerName, playerId])

  const resetGame = async () => {
    if (searching) cancelSearch()
    if (roomId && gameState) {
      if (playerId === gameState.host) {
        await remove(ref(db, `${ROOMS_PATH}/${roomId}`))
      } else {
        await update(ref(db, `${ROOMS_PATH}/${roomId}`), {
          guest: '',
          guestName: '',
          status: 'waiting'
        })
      }
    }
    setGameState(null)
    setJoined(false)
    setRoomId('')
  }

  if (!joined) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <div className="inline-flex p-5 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-800 glow-purple mb-4">
            <Grid3X3 className="w-12 h-12 text-white" />
          </div>
          <h1 className="game-title text-2xl text-purple-300 mb-2">X și 0</h1>
          <p className="text-gray-400 text-sm">Clasicul Tic-Tac-Toe, acum online cu prietenii.</p>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="Numele tau..."
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-gray-800/80 border border-purple-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-purple-400"
          />

          <button
            onClick={findOnlinePlayer}
            disabled={searching || !playerName.trim()}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-bold hover:from-purple-400 hover:to-indigo-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {searching ? (
              <>
                <Search className="w-5 h-5 animate-spin" />
                Cautam jucator...
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                Cauta jucator rapid
              </>
            )}
          </button>
          {searching && (
            <button
              onClick={cancelSearch}
              className="w-full py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-sm hover:bg-red-500/30 transition-all"
            >
              Anuleaza cautarea
            </button>
          )}

          <button
            onClick={createRoom}
            className="w-full py-3 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 font-bold hover:bg-purple-500/30 transition-all"
          >
            Creeaza camera privata
          </button>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="ID camera..."
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="flex-1 px-4 py-3 rounded-xl bg-gray-800/80 border border-purple-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-purple-400"
            />
            <button
              onClick={joinRoom}
              className="px-6 py-3 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 font-bold hover:bg-purple-500/30 transition-all"
            >
              Intra
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isMyTurn = gameState?.turn === playerId
  const playerSymbol = isHost ? 'X' : 'O'

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2">
          {gameState?.status === 'waiting' ? (
            <div className="text-center p-12 rounded-2xl bg-gray-800/50 border border-purple-500/20 backdrop-blur-sm">
              <div className="animate-bounce mb-6">
                <Search className="w-16 h-16 text-purple-400 mx-auto" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Așteptăm un adversar...</h2>
              <p className="text-gray-400 mb-6 text-sm">Trimite ID-ul camerei unui prieten:</p>
              <div className="bg-[#0f0f1a] p-4 rounded-xl border border-purple-500/30 font-mono text-purple-300 break-all">
                {roomId}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-xl bg-gray-800/50 border border-purple-500/20">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${isMyTurn ? 'bg-green-500/20 text-green-400 animate-pulse' : 'bg-gray-700 text-gray-400'}`}>
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Status</p>
                    <p className={`font-bold ${isMyTurn ? 'text-green-400' : 'text-gray-300'}`}>
                      {gameState?.winner ? 'Joc încheiat' : (isMyTurn ? 'Rândul tău' : 'Așteaptă...')}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Simbolul tău</p>
                  <p className="text-2xl font-black text-purple-400">{playerSymbol}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 aspect-square max-w-[400px] mx-auto">
                {gameState?.board?.map((cell, i) => (
                  <button
                    key={i}
                    onClick={() => makeMove(i)}
                    disabled={!isMyTurn || cell !== null || !!gameState.winner}
                    className={`aspect-square rounded-2xl text-4xl font-black flex items-center justify-center transition-all duration-200
                      ${!cell && isMyTurn ? 'hover:bg-purple-500/10 border-2 border-dashed border-purple-500/20' : 'bg-gray-800/80 border-2 border-purple-500/10'}
                      ${cell === 'X' ? 'text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'text-pink-400 shadow-[0_0_15px_rgba(236,72,153,0.3)]'}
                      ${!isMyTurn && !cell ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
                    `}
                  >
                    {cell}
                  </button>
                ))}
              </div>

              {gameState?.winner && (
                <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-600/20 to-indigo-600/20 border border-purple-500/30 text-center animate-in fade-in zoom-in duration-300">
                  <Trophy className="w-12 h-12 text-yellow-400 mx-auto mb-3" />
                  <h3 className="text-2xl font-black text-white mb-2">
                    {gameState.winner === 'draw' ? 'Remiză!' : (
                      gameState.winner === playerSymbol ? 'Ai câștigat! 🎉' : 'Ai pierdut! 😅'
                    )}
                  </h3>
                  <button
                    onClick={restartGame}
                    className="px-6 py-2 rounded-xl bg-purple-500 text-white font-bold hover:bg-purple-400 transition-all flex items-center gap-2 mx-auto"
                  >
                    <RotateCcw className="w-5 h-5" /> Joacă din nou
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col h-[600px]">
          <div className="p-4 rounded-t-2xl bg-gray-800/80 border-x border-t border-purple-500/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-400" />
              <span className="font-bold text-gray-200">Scor</span>
            </div>
            <div className="flex gap-4">
              <div className="text-center">
                <p className="text-[10px] text-gray-500 font-bold">HOST (X)</p>
                <p className="text-xl font-black text-blue-400">{gameState?.hostScore || 0}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-gray-500 font-bold">GUEST (O)</p>
                <p className="text-xl font-black text-pink-400">{gameState?.guestScore || 0}</p>
              </div>
            </div>
          </div>

          <div className="flex-1 bg-gray-900/50 border-x border-purple-500/10 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center gap-2 text-gray-500 mb-4">
              <MessageSquare className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-widest">Chat Live</span>
            </div>
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.player === playerName ? 'items-end' : 'items-start'}`}>
                <span className="text-[10px] text-gray-500 mb-1">{msg.player}</span>
                <div className={`px-3 py-2 rounded-2xl text-sm max-w-[80%] ${
                  msg.player === playerName
                    ? 'bg-purple-600 text-white rounded-tr-none'
                    : 'bg-gray-800 text-gray-200 rounded-tl-none border border-purple-500/10'
                }`}>
                  {msg.message}
                </div>
              </div>
            ))}
            {chatMessages.length === 0 && (
              <p className="text-center text-gray-600 text-xs italic mt-10">Începe o conversație...</p>
            )}
          </div>

          <div className="p-4 rounded-b-2xl bg-gray-800/80 border-x border-b border-purple-500/20">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Scrie un mesaj..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                className="flex-1 bg-[#0f0f1a] border border-purple-500/20 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50 transition-all"
              />
              <button
                onClick={sendMessage}
                className="p-2 bg-purple-500 text-white rounded-xl hover:bg-purple-400 transition-all"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>

          <button
            onClick={resetGame}
            className="mt-4 flex items-center justify-center gap-2 text-gray-500 hover:text-red-400 transition-colors text-sm font-medium"
          >
            <RotateCcw className="w-4 h-4" /> Ieși din cameră
          </button>
        </div>
      </div>
    </div>
  )
}
