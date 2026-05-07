import { useState, useEffect, useRef, useCallback } from 'react'
import { ref, set, onValue, onChildAdded, push, remove, get, update } from 'firebase/database'
import { db } from '../../firebase'
import { joinLobby, leaveLobby, listenForLobbyMatch, setLobbyMatch } from '../../utils/matchmaking'
import { Palette, Send, Clock, Eraser, RotateCcw, Search } from 'lucide-react'

const GAME_ID = 'skribbl'
const ROOMS_PATH = 'skribbl-rooms'
const ROUND_TIME = 60
const WORD_OPTIONS_COUNT = 3

const WORDS_RO = [
  'soare', 'pisica', 'casa', 'copac', 'masina', 'floare', 'caine', 'carte',
  'avion', 'munte', 'rau', 'peste', 'luna', 'stea', 'ploaie', 'zapada',
  'inghet', 'balon', 'tort', 'umbrela', 'ochelari', 'ceas', 'bicicleta', 'chitara',
  'robot', 'castel', 'dragon', 'unicorn', 'vulcan', 'insula', 'paianjen', 'fluture',
  'elefant', 'girafa', 'pinguin', 'dinozaur', 'racheta', 'telescop', 'ancora', 'corabie',
  'trompeta', 'pian', 'toba', 'vioara', 'foc', 'apa', 'vant', 'nor',
  'curcubeu', 'diamant', 'coroana', 'sabie', 'scut', 'arc', 'sageata', 'lacat',
  'cheie', 'lampa', 'lumanare', 'oglinda', 'perie', 'foarfeca', 'ac', 'fir',
]

const COLORS = ['#ffffff', '#ff0000', '#ff6600', '#ffff00', '#00ff00', '#0066ff', '#9900ff', '#ff00ff', '#000000', '#8B4513']
const BRUSH_SIZES = [3, 6, 12, 20]

const normalizeText = (value = '') => {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[ăâ]/g, 'a')
    .replace(/î/g, 'i')
    .replace(/[șş]/g, 's')
    .replace(/[țţ]/g, 't')
  return base.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

const getWordOptions = () => {
  const options = new Set()
  while (options.size < WORD_OPTIONS_COUNT) {
    options.add(WORDS_RO[Math.floor(Math.random() * WORDS_RO.length)])
  }
  return Array.from(options)
}

export default function Skribbl() {
  const [playerId] = useState(() => 'p_' + Math.random().toString(36).substr(2, 9))
  const [playerName, setPlayerName] = useState('')
  const [joined, setJoined] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [gameState, setGameState] = useState(null)
  const [guess, setGuess] = useState('')
  const [chatMessages, setChatMessages] = useState([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [wordOptions, setWordOptions] = useState([])
  const [customWord, setCustomWord] = useState('')
  const [brushColor, setBrushColor] = useState('#ffffff')
  const [brushSize, setBrushSize] = useState(6)
  const [isErasing, setIsErasing] = useState(false)
  const [searching, setSearching] = useState(false)

  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const lastPosRef = useRef(null)
  const timerRef = useRef(null)
  const matchUnsubRef = useRef(null)
  const lastClearRef = useRef(0)
  const canvasReadyRef = useRef(false)
  const strokesCacheRef = useRef([])
  const advanceRoundRef = useRef(0)

  const clearCanvasLocal = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    strokesCacheRef.current = []
  }, [])

  const clearCanvasForAll = useCallback(async () => {
    clearCanvasLocal()
    if (!roomId) return
    await remove(ref(db, `${ROOMS_PATH}/${roomId}/strokes`))
    await set(ref(db, `${ROOMS_PATH}/${roomId}/clearAt`), Date.now())
  }, [roomId, clearCanvasLocal])

  const prepareRound = useCallback(async (drawerId, roundNumber) => {
    if (!roomId) return
    const options = getWordOptions()
    await update(ref(db, `${ROOMS_PATH}/${roomId}`), {
      drawer: drawerId,
      round: roundNumber,
      currentWord: '',
      wordOptions: options,
      timeLeft: ROUND_TIME,
      guessedCorrectly: false,
    })
    await remove(ref(db, `${ROOMS_PATH}/${roomId}/chat`))
    await clearCanvasForAll()
  }, [roomId, clearCanvasForAll])

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
      drawer: playerId,
      round: 1,
      currentWord: '',
      wordOptions: [],
      timeLeft: ROUND_TIME,
      guessedCorrectly: false,
    }
    await set(roomRef, initialState)
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
        setGameState(data)
        setIsDrawing(data.drawer === playerId)
        setWordOptions(Array.isArray(data.wordOptions) ? data.wordOptions : [])
      }
    })
    return () => unsubscribe()
  }, [joined, roomId, playerId])

  useEffect(() => {
    if (!joined || !roomId) return
    const chatRef = ref(db, `${ROOMS_PATH}/${roomId}/chat`)
    const unsubscribe = onValue(chatRef, (snapshot) => {
      if (snapshot.exists()) {
        const msgs = Object.values(snapshot.val())
        setChatMessages(msgs)
      } else {
        setChatMessages([])
      }
    })
    return () => unsubscribe()
  }, [joined, roomId])

  useEffect(() => {
    if (!gameState || gameState.status !== 'playing') return
    if (playerId !== gameState.host) return
    if (!gameState.guest) return
    if (gameState.currentWord) return
    if (Array.isArray(gameState.wordOptions) && gameState.wordOptions.length > 0) return
    prepareRound(gameState.drawer || gameState.host, gameState.round || 1)
  }, [gameState, playerId, prepareRound])

  const selectWord = async (word) => {
    if (!isDrawing || !roomId) return
    if (!word) return
    await update(ref(db, `${ROOMS_PATH}/${roomId}`), {
      currentWord: word,
      wordOptions: [],
      timeLeft: ROUND_TIME,
      guessedCorrectly: false,
    })
    setCustomWord('')
  }

  const applyCustomWord = async () => {
    const word = customWord.trim()
    if (!word) return
    await selectWord(word)
  }

  const sendGuess = async () => {
    if (!guess.trim() || !roomId || !gameState?.currentWord) return
    if (isDrawing) return

    const isCorrect = normalizeText(guess) === normalizeText(gameState.currentWord)
    await push(ref(db, `${ROOMS_PATH}/${roomId}/chat`), {
      player: playerName,
      message: guess,
      correct: isCorrect,
      timestamp: Date.now(),
    })

    if (isCorrect) {
      const drawerKey = gameState.drawer === gameState.host ? 'hostScore' : 'guestScore'
      const guesserKey = isHost ? 'hostScore' : 'guestScore'
      const updates = {
        guessedCorrectly: true,
      }
      if (drawerKey === guesserKey) {
        updates[guesserKey] = (gameState[guesserKey] || 0) + 1
      } else {
        updates[guesserKey] = (gameState[guesserKey] || 0) + 1
        updates[drawerKey] = (gameState[drawerKey] || 0) + 1
      }
      await update(ref(db, `${ROOMS_PATH}/${roomId}`), updates)
      await push(ref(db, `${ROOMS_PATH}/${roomId}/chat`), {
        player: 'Sistem',
        message: `✅ ${playerName} a ghicit! Cuvantul era: ${gameState.currentWord}`,
        system: true,
        timestamp: Date.now(),
      })
    }
    setGuess('')
  }

  useEffect(() => {
    if (!gameState || gameState.status !== 'playing') return
    if (!gameState.guessedCorrectly) return
    if (playerId !== gameState.host) return
    if (!gameState.guest) return
    if (advanceRoundRef.current === gameState.round) return
    advanceRoundRef.current = gameState.round

    const nextDrawer = gameState.drawer === gameState.host ? gameState.guest : gameState.host
    setTimeout(() => prepareRound(nextDrawer, (gameState.round || 1) + 1), 800)
  }, [gameState?.guessedCorrectly, gameState?.round, gameState?.status, gameState?.drawer, gameState?.host, gameState?.guest, playerId, prepareRound])

  useEffect(() => {
    if (!gameState || gameState.status !== 'playing') return
    if (!isHost || !roomId) return
    if (!gameState.currentWord || gameState.guessedCorrectly) return

    const interval = setInterval(async () => {
      const current = await get(ref(db, `${ROOMS_PATH}/${roomId}/timeLeft`))
      const val = current.val()
      if (val && val > 0) {
        await set(ref(db, `${ROOMS_PATH}/${roomId}/timeLeft`), val - 1)
      } else if (val === 0) {
        await update(ref(db, `${ROOMS_PATH}/${roomId}`), { guessedCorrectly: true })
        await push(ref(db, `${ROOMS_PATH}/${roomId}/chat`), {
          player: 'Sistem',
          message: `⏰ Timpul a expirat! Cuvantul era: ${gameState.currentWord}`,
          system: true,
          timestamp: Date.now(),
        })
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [gameState?.status, gameState?.currentWord, gameState?.guessedCorrectly, isHost, roomId])

  const drawStroke = useCallback((stroke) => {
    const canvas = canvasRef.current
    if (!canvas || !stroke) return
    const ctx = canvas.getContext('2d')
    const scale = stroke.bw ? canvas.width / stroke.bw : 1
    const fromX = (stroke.fx ?? 0) * canvas.width
    const fromY = (stroke.fy ?? 0) * canvas.height
    const toX = (stroke.tx ?? 0) * canvas.width
    const toY = (stroke.ty ?? 0) * canvas.height

    ctx.beginPath()
    ctx.moveTo(fromX, fromY)
    ctx.lineTo(toX, toY)
    ctx.strokeStyle = stroke.erasing ? '#1a1a2e' : stroke.color
    ctx.lineWidth = (stroke.size || 4) * scale * (stroke.erasing ? 3 : 1)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
  }, [])

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    canvasReadyRef.current = true

    const cached = strokesCacheRef.current
    if (cached.length > 0) {
      cached.forEach((stroke) => drawStroke(stroke))
    }
  }, [drawStroke])

  useEffect(() => {
    if (joined) {
      setTimeout(initCanvas, 100)
    }
  }, [joined, gameState?.status, initCanvas])

  useEffect(() => {
    if (!roomId) return
    const strokesRef = ref(db, `${ROOMS_PATH}/${roomId}/strokes`)
    const unsubscribe = onChildAdded(strokesRef, (snapshot) => {
      const stroke = snapshot.val()
      if (!stroke || stroke.playerId === playerId) return
      strokesCacheRef.current.push(stroke)
      if (canvasReadyRef.current) {
        drawStroke(stroke)
      }
    })
    return () => unsubscribe()
  }, [roomId, playerId, drawStroke])

  useEffect(() => {
    if (!roomId) return
    const clearRef = ref(db, `${ROOMS_PATH}/${roomId}/clearAt`)
    const unsubscribe = onValue(clearRef, (snapshot) => {
      const val = snapshot.val()
      if (val && val !== lastClearRef.current) {
        lastClearRef.current = val
        clearCanvasLocal()
      }
    })
    return () => unsubscribe()
  }, [roomId, clearCanvasLocal])

  const getCanvasPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    }
  }

  const canDraw = isDrawing && gameState?.currentWord

  const startDraw = (e) => {
    if (!canDraw) return
    e.preventDefault()
    drawingRef.current = true
    lastPosRef.current = getCanvasPos(e)
  }

  const draw = (e) => {
    if (!canDraw) return
    e.preventDefault()
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getCanvasPos(e)

    const from = lastPosRef.current
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = isErasing ? '#1a1a2e' : brushColor
    ctx.lineWidth = isErasing ? brushSize * 3 : brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()

    if (roomId) {
      const width = canvas.width || 1
      const height = canvas.height || 1
      push(ref(db, `${ROOMS_PATH}/${roomId}/strokes`), {
        playerId,
        fx: from.x / width,
        fy: from.y / height,
        tx: pos.x / width,
        ty: pos.y / height,
        color: brushColor,
        size: brushSize,
        erasing: isErasing,
        bw: width,
        bh: height,
        ts: Date.now(),
      })
    }

    lastPosRef.current = pos
  }

  const stopDraw = () => {
    drawingRef.current = false
  }

  const clearCanvas = () => {
    if (isDrawing) {
      clearCanvasForAll()
    }
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
        drawer: playerId,
        round: 1,
        currentWord: '',
        wordOptions: [],
        timeLeft: ROUND_TIME,
        guessedCorrectly: false,
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
          drawer: playerId,
          round: 1,
          currentWord: '',
          wordOptions: [],
          timeLeft: ROUND_TIME,
          guessedCorrectly: false,
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
          status: 'waiting',
          currentWord: '',
          wordOptions: [],
          guessedCorrectly: false,
          timeLeft: ROUND_TIME,
        })
        await clearCanvasForAll()
      }
    }
    setGameState(null)
    setJoined(false)
    setRoomId('')
    setChatMessages([])
    setGuess('')
    setCustomWord('')
  }

  if (!joined) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <div className="inline-flex p-5 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-800 glow-blue mb-4">
            <Palette className="w-12 h-12 text-white" />
          </div>
          <h1 className="game-title text-2xl text-blue-300 mb-2">SKRIBBL</h1>
          <p className="text-gray-400 text-sm">Deseneaza pe rand si ghiceste cuvintele.</p>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="Numele tau..."
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-gray-800/80 border border-blue-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-blue-400"
          />

          <button
            onClick={findOnlinePlayer}
            disabled={searching || !playerName.trim()}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-pink-600 text-white font-bold hover:from-blue-400 hover:to-pink-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
            className="w-full py-3 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-300 font-bold hover:bg-blue-500/30 transition-all"
          >
            Creeaza camera privata
          </button>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="ID camera..."
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="flex-1 px-4 py-3 rounded-xl bg-gray-800/80 border border-blue-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-blue-400"
            />
            <button
              onClick={joinRoom}
              className="px-6 py-3 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-300 font-bold hover:bg-blue-500/30 transition-all"
            >
              Intra
            </button>
          </div>
        </div>
      </div>
    )
  }

  const displayTimeLeft = gameState?.currentWord ? gameState?.timeLeft : null
  const isChoosingWord = isDrawing && !gameState?.currentWord && wordOptions.length > 0
  const drawerName = gameState?.drawer === gameState?.host ? gameState?.hostName : gameState?.guestName

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {gameState?.status === 'waiting' && (
        <div className="text-center mb-6 p-6 rounded-xl bg-gray-800/80 border border-blue-500/30">
          <p className="text-blue-300 mb-2">Asteptam un jucator...</p>
          <p className="text-gray-400 text-sm mb-2">ID camera:</p>
          <p className="game-title text-lg text-blue-300 break-all">{roomId}</p>
        </div>
      )}

      {gameState?.status === 'playing' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <span className="text-blue-300 font-bold">Runda {gameState.round}</span>
              <span className="text-gray-400">|</span>
              <span className="text-gray-300">
                Scor: <span className="text-blue-300">{gameState.hostScore}</span> - <span className="text-red-300">{gameState.guestScore}</span>
              </span>
              {drawerName && (
                <span className="text-gray-400 text-sm">Deseneaza: {drawerName}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-yellow-400" />
              <span className={`game-title text-lg ${displayTimeLeft !== null && displayTimeLeft <= 10 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                {displayTimeLeft === null ? '--' : `${displayTimeLeft}s`}
              </span>
            </div>
          </div>

          {isChoosingWord && (
            <div className="mb-4 p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
              <p className="text-blue-300 text-sm mb-2">Alege cuvantul:</p>
              <div className="flex flex-wrap gap-2">
                {wordOptions.map((word) => (
                  <button
                    key={word}
                    onClick={() => selectWord(word)}
                    className="px-4 py-2 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-200 hover:bg-blue-500/30 transition-all text-sm"
                  >
                    {word}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isDrawing && gameState?.currentWord && (
            <div className="text-center mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
              <span className="text-gray-400 text-sm">Cuvant de desenat: </span>
              <span className="game-title text-lg text-blue-300">{gameState.currentWord}</span>
            </div>
          )}

          {isDrawing && (
            <div className="mb-3 flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="Seteaza cuvantul manual..."
                value={customWord}
                onChange={(e) => setCustomWord(e.target.value)}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-800/80 border border-blue-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-blue-400 text-sm"
              />
              <button
                onClick={applyCustomWord}
                className="px-4 py-2 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-all text-sm"
              >
                Seteaza
              </button>
            </div>
          )}

          {!isDrawing && (
            <div className="text-center mb-4 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
              {gameState?.currentWord ? (
                <>
                  <span className="text-orange-300 text-sm">Tu ghicesti! Privește desenul si scrie raspunsul.</span>
                  <span className="text-gray-400 text-sm ml-2">
                    ({gameState.currentWord?.length} litere: {gameState.currentWord?.split('').map(() => '_ ').join('')})
                  </span>
                </>
              ) : (
                <span className="text-orange-300 text-sm">Asteptam ca desenatorul sa aleaga cuvantul...</span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <div className="canvas-container rounded-xl overflow-hidden border border-gray-700/50">
                <canvas
                  ref={canvasRef}
                  className="w-full touch-none"
                  style={{ height: '400px' }}
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={stopDraw}
                  onMouseLeave={stopDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={stopDraw}
                />
              </div>

              {isDrawing && (
                <div className="mt-3 flex flex-wrap items-center gap-3 p-3 rounded-lg bg-gray-800/80 border border-gray-700/30">
                  <div className="flex gap-1">
                    {COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => { setBrushColor(c); setIsErasing(false) }}
                        className={`w-7 h-7 rounded-full border-2 transition-all ${brushColor === c && !isErasing ? 'border-white scale-110' : 'border-gray-600'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {BRUSH_SIZES.map(s => (
                      <button
                        key={s}
                        onClick={() => setBrushSize(s)}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${brushSize === s ? 'bg-blue-500/30 border border-blue-400' : 'bg-gray-700/50 border border-gray-600'}`}
                      >
                        <div className="rounded-full bg-white" style={{ width: s, height: s }} />
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setIsErasing(!isErasing)}
                    className={`p-2 rounded-lg transition-all ${isErasing ? 'bg-red-500/30 border border-red-400' : 'bg-gray-700/50 border border-gray-600'}`}
                  >
                    <Eraser className="w-5 h-5 text-white" />
                  </button>
                  <button
                    onClick={clearCanvas}
                    className="p-2 rounded-lg bg-gray-700/50 border border-gray-600 hover:bg-red-500/20 transition-all"
                  >
                    <RotateCcw className="w-5 h-5 text-white" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col h-full">
              <div className="flex-1 p-4 rounded-xl bg-gray-800/80 border border-gray-700/30 max-h-80 overflow-y-auto mb-3">
                <p className="text-xs text-gray-500 font-bold mb-2">CHAT</p>
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`py-1 ${msg.system ? 'text-yellow-300 text-xs italic' : ''}`}>
                    {msg.system ? (
                      msg.message
                    ) : (
                      <>
                        <span className={`font-bold text-sm ${msg.correct ? 'text-green-400' : 'text-blue-300'}`}>
                          {msg.player}:
                        </span>{' '}
                        <span className="text-gray-300 text-sm">{msg.message}</span>
                      </>
                    )}
                  </div>
                ))}
                {chatMessages.length === 0 && (
                  <p className="text-gray-600 text-xs">Niciun mesaj inca...</p>
                )}
              </div>

              {!isDrawing && gameState?.currentWord && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Ghicește cuvantul..."
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendGuess()}
                    className="flex-1 px-4 py-2 rounded-lg bg-gray-800/80 border border-blue-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-blue-400 text-sm"
                  />
                  <button
                    onClick={sendGuess}
                    className="p-2 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-all"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={resetGame}
            className="mt-6 px-4 py-2 rounded-lg bg-gray-700/50 text-gray-400 text-sm hover:bg-gray-700 transition-all"
          >
            <RotateCcw className="w-4 h-4 inline mr-1" />
            Iesi din joc
          </button>
        </>
      )}
    </div>
  )
}
