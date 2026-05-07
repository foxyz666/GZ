import { useState, useEffect, useCallback, useRef } from 'react'
import { ref, set, onValue, push, remove, get } from 'firebase/database'
import { db } from '../../firebase'
import { joinLobby, leaveLobby, listenForLobbyMatch } from '../../utils/matchmaking'
import { Brain, Play, RotateCcw, Skull, Trophy, Volume2, Search } from 'lucide-react'

const COLORS_SEQUENCE = [
  { id: 'red', color: '#ef4444', sound: 261.63 },
  { id: 'blue', color: '#3b82f6', sound: 329.63 },
  { id: 'green', color: '#22c55e', sound: 392.00 },
  { id: 'yellow', color: '#eab308', sound: 523.25 },
  { id: 'purple', color: '#a855f7', sound: 587.33 },
  { id: 'orange', color: '#f97316', sound: 659.25 },
]

const GAME_STATES = { IDLE: 'idle', SHOWING: 'showing', INPUT: 'input', SUCCESS: 'success', FAIL: 'fail' }

export default function MemoryGame() {
  const [playerId] = useState(() => 'p_' + Math.random().toString(36).substr(2, 9))
  const [playerName, setPlayerName] = useState('')
  const [joined, setJoined] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [gameState, setGameState] = useState(null)
  const [localState, setLocalState] = useState(GAME_STATES.IDLE)
  const [sequence, setSequence] = useState([])
  const [playerInput, setPlayerInput] = useState([])
  const [showingIndex, setShowingIndex] = useState(-1)
  const [level, setLevel] = useState(0)
  const [highScore, setHighScore] = useState(0)
  const [activeColor, setActiveColor] = useState(null)
  const [opponentLevel, setOpponentLevel] = useState(0)
  const [opponentFailed, setOpponentFailed] = useState(false)
  const [iFailed, setIFailed] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [searching, setSearching] = useState(false)
  const matchUnsubRef = useRef(null)
  const audioCtxRef = useRef(null)

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    return audioCtxRef.current
  }

  const playTone = useCallback((frequency, duration = 300) => {
    if (!soundEnabled) return
    try {
      const ctx = getAudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = frequency
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000)
      osc.start()
      osc.stop(ctx.currentTime + duration / 1000)
    } catch (e) {}
  }, [soundEnabled])

  const playFailSound = useCallback(() => {
    if (!soundEnabled) return
    try {
      const ctx = getAudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 100
      osc.type = 'sawtooth'
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8)
      osc.start()
      osc.stop(ctx.currentTime + 0.8)
    } catch (e) {}
  }, [soundEnabled])

  const addToSequence = useCallback(() => {
    const randomColor = COLORS_SEQUENCE[Math.floor(Math.random() * COLORS_SEQUENCE.length)]
    return randomColor
  }, [])

  const startGame = useCallback(() => {
    const first = addToSequence()
    const second = addToSequence()
    const newSeq = [first, second]
    setSequence(newSeq)
    setLevel(2)
    setPlayerInput([])
    setLocalState(GAME_STATES.SHOWING)
    setIFailed(false)
    setOpponentFailed(false)
    showSequence(newSeq)
  }, [addToSequence])

  const showSequence = useCallback((seq) => {
    setLocalState(GAME_STATES.SHOWING)
    seq.forEach((color, i) => {
      setTimeout(() => {
        setShowingIndex(i)
        setActiveColor(color.id)
        playTone(color.sound)
      }, i * 700)
    })
    setTimeout(() => {
      setShowingIndex(-1)
      setActiveColor(null)
      setLocalState(GAME_STATES.INPUT)
      setPlayerInput([])
    }, seq.length * 700 + 500)
  }, [playTone])

  const handleColorClick = useCallback((color) => {
    if (localState !== GAME_STATES.INPUT) return
    setActiveColor(color.id)
    playTone(color.sound)
    setTimeout(() => setActiveColor(null), 200)

    const newInput = [...playerInput, color]
    setPlayerInput(newInput)

    const currentIndex = newInput.length - 1
    if (newInput[currentIndex].id !== sequence[currentIndex].id) {
      setLocalState(GAME_STATES.FAIL)
      setIFailed(true)
      playFailSound()
      if (highScore < level - 1) setHighScore(level - 1)
      if (roomId !== 'solo' && roomId) {
        set(ref(db, `memory-rooms/${roomId}/${isHost ? 'host' : 'guest'}Failed`), true)
        set(ref(db, `memory-rooms/${roomId}/${isHost ? 'host' : 'guest'}Level`), level - 1)
      }
      return
    }

    if (newInput.length === sequence.length) {
      setLocalState(GAME_STATES.SUCCESS)
      const nextColor = addToSequence()
      const newSeq = [...sequence, nextColor]
      setSequence(newSeq)
      setLevel(prev => prev + 1)
      setPlayerInput([])
      if (roomId !== 'solo' && roomId) {
        set(ref(db, `memory-rooms/${roomId}/${isHost ? 'host' : 'guest'}Level`), level + 1)
      }
      setTimeout(() => showSequence(newSeq), 1000)
    }
  }, [localState, playerInput, sequence, level, playTone, playFailSound, addToSequence, showSequence, highScore, roomId, isHost])

  const playSolo = () => {
    if (!playerName.trim()) return
    setRoomId('solo')
    setIsHost(true)
    setJoined(true)
    setGameState({ status: 'playing' })
  }

  const createRoom = async () => {
    if (!playerName.trim()) return
    const roomRef = push(ref(db, 'memory-rooms'))
    const newRoomId = roomRef.key
    await set(roomRef, {
      status: 'waiting',
      host: playerId,
      hostName: playerName,
      guest: '',
      guestName: '',
      hostLevel: 0,
      guestLevel: 0,
      hostFailed: false,
      guestFailed: false,
    })
    setRoomId(newRoomId)
    setIsHost(true)
    setJoined(true)
  }

  const joinRoom = async () => {
    if (!playerName.trim() || !roomId.trim()) return
    const roomRef = ref(db, `memory-rooms/${roomId}`)
    const snapshot = await get(roomRef)
    if (!snapshot.exists()) {
      alert('Camera nu există!')
      return
    }
    const data = snapshot.val()
    if (data.guest) {
      alert('Camera este plină!')
      return
    }
    await set(ref(db, `memory-rooms/${roomId}/guest`), playerId)
    await set(ref(db, `memory-rooms/${roomId}/guestName`), playerName)
    await set(ref(db, `memory-rooms/${roomId}/status`), 'playing')
    setJoined(true)
    setIsHost(false)
  }

  useEffect(() => {
    if (!joined || roomId === 'solo') return
    const roomRef = ref(db, `memory-rooms/${roomId}`)
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val()
        setGameState(data)
        if (isHost) {
          setOpponentLevel(data.guestLevel || 0)
          setOpponentFailed(data.guestFailed || false)
        } else {
          setOpponentLevel(data.hostLevel || 0)
          setOpponentFailed(data.hostFailed || false)
        }
        if (data.hostFailed && data.guestFailed) {
          setLocalState(GAME_STATES.FAIL)
        }
      }
    })
    return () => unsubscribe()
  }, [joined, roomId, isHost])

  const cancelSearch = useCallback(() => {
    setSearching(false)
    leaveLobby('memory', playerId)
    if (matchUnsubRef.current) {
      matchUnsubRef.current()
      matchUnsubRef.current = null
    }
  }, [playerId])

  const findOnlinePlayer = useCallback(async () => {
    if (!playerName.trim()) return
    setSearching(true)
    const result = await joinLobby('memory', playerId, playerName)
    if (result.matched) {
      setSearching(false)
      const roomRef = push(ref(db, 'memory-rooms'))
      const newRoomId = roomRef.key
      await set(roomRef, {
        status: 'playing',
        host: playerId,
        hostName: playerName,
        guest: result.playerId,
        guestName: result.playerName,
        hostLevel: 0,
        guestLevel: 0,
        hostFailed: false,
        guestFailed: false,
      })
      setRoomId(newRoomId)
      setIsHost(true)
      setJoined(true)
    } else {
      matchUnsubRef.current = listenForLobbyMatch('memory', playerId, async (matched) => {
        setSearching(false)
        if (matchUnsubRef.current) {
          matchUnsubRef.current()
          matchUnsubRef.current = null
        }
        await leaveLobby('memory', playerId)
        const roomRef = push(ref(db, 'memory-rooms'))
        const newRoomId = roomRef.key
        await set(roomRef, {
          status: 'playing',
          host: matched.playerId,
          hostName: matched.playerName,
          guest: playerId,
          guestName: playerName,
          hostLevel: 0,
          guestLevel: 0,
          hostFailed: false,
          guestFailed: false,
        })
        setRoomId(newRoomId)
        setIsHost(false)
        setJoined(true)
      })
    }
  }, [playerName, playerId])

  const resetGame = () => {
    if (searching) cancelSearch()
    if (roomId !== 'solo' && roomId) {
      remove(ref(db, `memory-rooms/${roomId}`))
    }
    setGameState(null)
    setJoined(false)
    setRoomId('')
    setLocalState(GAME_STATES.IDLE)
    setSequence([])
    setPlayerInput([])
    setLevel(0)
    setIFailed(false)
    setOpponentFailed(false)
    setOpponentLevel(0)
  }

  if (!joined) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <div className="inline-flex p-5 rounded-2xl bg-gradient-to-br from-green-600 to-emerald-800 glow-green mb-4">
            <Brain className="w-12 h-12 text-white" />
          </div>
          <h1 className="game-title text-2xl text-green-300 mb-2">MEMORIE VS MEMORIE</h1>
          <p className="text-gray-400 text-sm">Repă secvența de culori și sunete. Cine greșește primul pierde!</p>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="Numele tău..."
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-gray-800/80 border border-green-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-green-400"
          />

          <button
            onClick={playSolo}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-green-600 to-emerald-700 text-white font-bold hover:from-green-500 hover:to-emerald-600 transition-all glow-green"
          >
            🧠 Joacă Solo
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-green-500/30"></div>
            <span className="text-gray-500 text-xs">SAU MULTIPLAYER</span>
            <div className="flex-1 h-px bg-green-500/30"></div>
          </div>

          <button
            onClick={findOnlinePlayer}
            disabled={searching || !playerName.trim()}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-pink-600 text-white font-bold hover:from-green-400 hover:to-pink-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {searching ? (
              <>
                <Search className="w-5 h-5 animate-spin" />
                Căutăm jucător...
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                Caută jucător online
              </>
            )}
          </button>
          {searching && (
            <button
              onClick={cancelSearch}
              className="w-full py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-sm hover:bg-red-500/30 transition-all"
            >
              Anulează căutarea
            </button>
          )}

          <button
            onClick={createRoom}
            className="w-full py-3 rounded-xl bg-green-500/20 border border-green-500/30 text-green-300 font-bold hover:bg-green-500/30 transition-all"
          >
            🏠 Creează cameră
          </button>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="ID cameră..."
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="flex-1 px-4 py-3 rounded-xl bg-gray-800/80 border border-green-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-green-400"
            />
            <button
              onClick={joinRoom}
              className="px-6 py-3 rounded-xl bg-green-500/20 border border-green-500/30 text-green-300 font-bold hover:bg-green-500/30 transition-all"
            >
              Intră
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {gameState?.status === 'waiting' && (
        <div className="text-center mb-8 p-6 rounded-xl bg-gray-800/80 border border-green-500/30">
          <p className="text-green-300 mb-2">Așteptăm un jucător...</p>
          <p className="text-gray-400 text-sm mb-2">ID cameră:</p>
          <p className="game-title text-lg text-green-300 break-all">{roomId}</p>
        </div>
      )}

      {gameState?.status === 'playing' && (
        <>
          <div className="flex items-center justify-between mb-6">
            <div className="text-center">
              <p className="text-green-300 font-bold text-sm">Tu</p>
              <p className="game-title text-2xl text-white">{level}</p>
              {iFailed && <Skull className="w-5 h-5 text-red-400 mx-auto mt-1" />}
            </div>
            <div className="text-center">
              <p className="text-gray-400 text-sm">Nivel</p>
              <p className="game-title text-3xl text-green-300">{level}</p>
            </div>
            {roomId !== 'solo' && (
              <div className="text-center">
                <p className="text-red-300 font-bold text-sm">Oponent</p>
                <p className="game-title text-2xl text-white">{opponentLevel}</p>
                {opponentFailed && <Skull className="w-5 h-5 text-red-400 mx-auto mt-1" />}
              </div>
            )}
            {roomId === 'solo' && (
              <div className="text-center">
                <p className="text-gray-400 text-sm">Record</p>
                <p className="game-title text-2xl text-yellow-300">{highScore}</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-2 mb-6">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg ${soundEnabled ? 'bg-green-500/20 text-green-300' : 'bg-gray-700/50 text-gray-500'} border border-gray-600/30`}
            >
              <Volume2 className="w-5 h-5" />
            </button>
            <span className="text-gray-400 text-sm">
              {localState === GAME_STATES.IDLE && 'Apasă Start pentru a începe'}
              {localState === GAME_STATES.SHOWING && '👀 Privește secvența...'}
              {localState === GAME_STATES.INPUT && '🎯 Repă secvența!'}
              {localState === GAME_STATES.SUCCESS && '✅ Corect! Nivelul crește...'}
              {localState === GAME_STATES.FAIL && '❌ Ai greșit!'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto mb-8">
            {COLORS_SEQUENCE.map((color) => (
              <button
                key={color.id}
                onClick={() => handleColorClick(color)}
                disabled={localState !== GAME_STATES.INPUT}
                className={`aspect-square rounded-2xl transition-all duration-150 border-2 ${
                  activeColor === color.id
                    ? 'scale-110 brightness-150 border-white shadow-lg'
                    : 'scale-100 brightness-75 border-transparent hover:brightness-90'
                } ${localState !== GAME_STATES.INPUT ? 'cursor-not-allowed' : 'cursor-pointer hover:scale-105'}`}
                style={{ backgroundColor: color.color }}
              />
            ))}
          </div>

          {localState === GAME_STATES.SHOWING && (
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/30">
                <span className="text-green-300 text-sm animate-pulse">
                  Arătăm secvența... ({showingIndex + 1}/{sequence.length})
                </span>
              </div>
            </div>
          )}

          {localState === GAME_STATES.INPUT && (
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <span className="text-blue-300 text-sm">
                  Progres: {playerInput.length}/{sequence.length}
                </span>
              </div>
            </div>
          )}

          {localState === GAME_STATES.FAIL && (
            <div className="text-center p-6 rounded-xl bg-red-500/10 border border-red-500/30">
              <Skull className="w-12 h-12 text-red-400 mx-auto mb-3" />
              <p className="game-title text-lg text-red-300 mb-2">AI GREȘIT!</p>
              <p className="text-gray-400 text-sm mb-4">
                Ai ajuns la nivelul {level > 0 ? level - 1 : 0}
                {roomId === 'solo' && level - 1 >= highScore && ' 🏆 Nou record!'}
              </p>
              <button
                onClick={() => { setLocalState(GAME_STATES.IDLE); setLevel(0); setSequence([]); setPlayerInput([]); setIFailed(false) }}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-green-600 to-emerald-700 text-white font-bold hover:from-green-500 hover:to-emerald-600 transition-all"
              >
                <RotateCcw className="w-5 h-5 inline mr-2" />
                Încearcă din nou
              </button>
            </div>
          )}

          {localState === GAME_STATES.IDLE && level === 0 && (
            <div className="text-center">
              <button
                onClick={startGame}
                className="px-8 py-4 rounded-xl bg-gradient-to-r from-green-600 to-emerald-700 text-white font-bold text-lg hover:from-green-500 hover:to-emerald-600 transition-all glow-green"
              >
                <Play className="w-6 h-6 inline mr-2" />
                START
              </button>
            </div>
          )}

          <button
            onClick={resetGame}
            className="mt-6 block mx-auto px-4 py-2 rounded-lg bg-gray-700/50 text-gray-400 text-sm hover:bg-gray-700 transition-all"
          >
            <RotateCcw className="w-4 h-4 inline mr-1" />
            Ieși din joc
          </button>
        </>
      )}
    </div>
  )
}
