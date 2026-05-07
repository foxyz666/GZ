import { useState, useEffect, useRef, useCallback } from 'react'
import { ref, set, onValue, onChildAdded, push, remove, get } from 'firebase/database'
import { db } from '../../firebase'
import { joinLobby, leaveLobby, listenForLobbyMatch, setLobbyMatch } from '../../utils/matchmaking'
import { Palette, Send, Clock, Users, Eraser, RotateCcw, Pencil, Search } from 'lucide-react'

const WORDS_RO = [
  'soare', 'pisică', 'casă', 'copac', 'mașină', 'floare', 'câine', 'carte',
  'avion', 'munte', 'râu', 'pește', 'lună', 'stea', 'ploaie', 'zăpadă',
  'ingeț', 'balon', 'tort', 'umbrelă', 'ochelari', 'ceas', 'bicicletă', 'chitară',
  'robot', 'castel', 'dragon', 'unicorn', 'vulcan', 'insulă', 'păianjen', 'fluture',
  'elefant', 'girafă', 'pinguin', 'dinozaur', 'rachetă', 'telescop', 'ancoră', 'corabie',
  'trompetă', 'pian', 'tobă', 'vioară', 'foc', 'apă', 'vânt', 'nor',
  'curcubeu', 'diamant', 'coroană', 'sabie', 'scut', 'arc', 'săgeată', 'lacăt',
  'cheie', 'lampă', 'lumânare', 'oglindă', 'perie', 'foarfece', 'ac', 'fir',
]

const COLORS = ['#ffffff', '#ff0000', '#ff6600', '#ffff00', '#00ff00', '#0066ff', '#9900ff', '#ff00ff', '#000000', '#8B4513']
const BRUSH_SIZES = [3, 6, 12, 20]

const ROUND_TIME = 60

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

export default function Pictionary() {
  const [playerId] = useState(() => 'p_' + Math.random().toString(36).substr(2, 9))
  const [playerName, setPlayerName] = useState('')
  const [joined, setJoined] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [gameState, setGameState] = useState(null)
  const [guess, setGuess] = useState('')
  const [chatMessages, setChatMessages] = useState([])
  const [currentWord, setCurrentWord] = useState('')
  const [timeLeft, setTimeLeft] = useState(ROUND_TIME)
  const [isDrawing, setIsDrawing] = useState(false)
  const [brushColor, setBrushColor] = useState('#ffffff')
  const [brushSize, setBrushSize] = useState(6)
  const [isErasing, setIsErasing] = useState(false)
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const lastPosRef = useRef(null)
  const timerRef = useRef(null)
  const [searching, setSearching] = useState(false)
  const [customWord, setCustomWord] = useState('')
  const advanceRoundRef = useRef(0)
  const matchUnsubRef = useRef(null)
  const lastClearRef = useRef(0)
  const canvasReadyRef = useRef(false)
  const strokesCacheRef = useRef([])

  const getRandomWord = () => WORDS_RO[Math.floor(Math.random() * WORDS_RO.length)]

  const createRoom = async () => {
    if (!playerName.trim()) return
    const word = getRandomWord()
    const roomRef = push(ref(db, 'pictionary-rooms'))
    const newRoomId = roomRef.key
    const initialState = {
      status: 'waiting',
      host: playerId,
      hostName: playerName,
      guest: '',
      guestName: '',
      hostScore: 0,
      guestScore: 0,
      currentWord: word,
      drawer: playerId,
      round: 1,
      timeLeft: ROUND_TIME,
      guessedCorrectly: false,
    }
    await set(roomRef, initialState)
    setRoomId(newRoomId)
    setIsHost(true)
    setJoined(true)
    setCurrentWord(word)
    setIsDrawing(true)
  }

  const joinRoom = async () => {
    if (!playerName.trim() || !roomId.trim()) return
    const roomRef = ref(db, `pictionary-rooms/${roomId}`)
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
    await set(ref(db, `pictionary-rooms/${roomId}/guest`), playerId)
    await set(ref(db, `pictionary-rooms/${roomId}/guestName`), playerName)
    await set(ref(db, `pictionary-rooms/${roomId}/status`), 'playing')
    setJoined(true)
    setIsHost(false)
    setIsDrawing(false)
  }

  const playSolo = () => {
    if (!playerName.trim()) return
    const word = getRandomWord()
    setRoomId('solo')
    setIsHost(true)
    setJoined(true)
    setCurrentWord(word)
    setIsDrawing(true)
    setGameState({
      status: 'playing',
      host: playerId,
      hostName: playerName,
      guest: '',
      guestName: 'Ghicitor',
      hostScore: 0,
      guestScore: 0,
      currentWord: word,
      drawer: playerId,
      round: 1,
      timeLeft: ROUND_TIME,
      guessedCorrectly: false,
    })
  }

  useEffect(() => {
    if (!joined || roomId === 'solo') return
    const roomRef = ref(db, `pictionary-rooms/${roomId}`)
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val()
        setGameState(data)
        setIsDrawing(data.drawer === playerId)
        setCurrentWord(data.drawer === playerId ? data.currentWord : '')
      }
    })
    return () => unsubscribe()
  }, [joined, roomId, playerId])

  useEffect(() => {
    if (!joined || roomId === 'solo') return
    const chatRef = ref(db, `pictionary-rooms/${roomId}/chat`)
    const unsubscribe = onValue(chatRef, (snapshot) => {
      if (snapshot.exists()) {
        const msgs = Object.values(snapshot.val())
        setChatMessages(msgs)
        const lastMsg = msgs[msgs.length - 1]
        if (lastMsg && lastMsg.correct) {
          handleCorrectGuess()
        }
      } else {
        setChatMessages([])
      }
    })
    return () => unsubscribe()
  }, [joined, roomId, handleCorrectGuess])

  const handleCorrectGuess = useCallback(() => {
    if (roomId === 'solo' || roomId === 'ai') return
    if (playerId !== gameState?.host) return
    const chatRef = ref(db, `pictionary-rooms/${roomId}/chat`)
    push(chatRef, {
      player: 'Sistem',
      message: '✅ Cuvânt ghicit corect! Runda se termină...',
      correct: false,
      system: true,
      timestamp: Date.now(),
    })
  }, [roomId, playerId, gameState?.host])

  const sendGuess = async () => {
    if (!guess.trim()) return
    if (roomId === 'solo') {
      const isCorrect = normalizeText(guess) === normalizeText(currentWord)
      setChatMessages(prev => [...prev, {
        player: playerName,
        message: guess,
        correct: isCorrect,
        timestamp: Date.now(),
      }])
      if (isCorrect) {
        setChatMessages(prev => [...prev, {
          player: 'Sistem',
          message: '✅ Corect! Cuvântul era: ' + currentWord,
          system: true,
          timestamp: Date.now(),
        }])
        clearInterval(timerRef.current)
        setTimeout(() => nextRoundSolo(), 500)
      }
      setGuess('')
      return
    }
    const isCorrect = normalizeText(guess) === normalizeText(gameState?.currentWord || '')
    await push(ref(db, `pictionary-rooms/${roomId}/chat`), {
      player: playerName,
      message: isCorrect ? '✅ A ghicit!' : guess,
      correct: isCorrect,
      timestamp: Date.now(),
    })
    if (isCorrect) {
      const myScoreKey = isHost ? 'hostScore' : 'guestScore'
      await set(ref(db, `pictionary-rooms/${roomId}/${myScoreKey}`), (isHost ? gameState.hostScore : gameState.guestScore) + 1)
      await set(ref(db, `pictionary-rooms/${roomId}/guessedCorrectly`), true)
    }
    setGuess('')
  }

  const applyCustomWord = async () => {
    if (!isDrawing) return
    const word = customWord.trim()
    if (!word) return
    if (roomId === 'solo') {
      setCurrentWord(word)
      setGameState(prev => (prev ? { ...prev, currentWord: word } : prev))
      setCustomWord('')
      return
    }
    await set(ref(db, `pictionary-rooms/${roomId}/currentWord`), word)
    await set(ref(db, `pictionary-rooms/${roomId}/guessedCorrectly`), false)
    setCustomWord('')
  }

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
    if (roomId && roomId !== 'solo') {
      await remove(ref(db, `pictionary-rooms/${roomId}/strokes`))
      await set(ref(db, `pictionary-rooms/${roomId}/clearAt`), Date.now())
    }
  }, [roomId, clearCanvasLocal])

  const nextRoundSolo = () => {
    const word = getRandomWord()
    setCurrentWord(word)
    clearCanvasLocal()
    setTimeLeft(ROUND_TIME)
    setGameState(prev => ({
      ...prev,
      currentWord: word,
      round: prev.round + 1,
      timeLeft: ROUND_TIME,
    }))
  }

  const nextRound = async () => {
    if (roomId === 'solo') {
      nextRoundSolo()
      return
    }
    const word = getRandomWord()
    const newDrawer = gameState?.drawer === gameState?.host ? gameState?.guest : gameState?.host
    await set(ref(db, `pictionary-rooms/${roomId}/currentWord`), word)
    await set(ref(db, `pictionary-rooms/${roomId}/drawer`), newDrawer)
    await set(ref(db, `pictionary-rooms/${roomId}/round`), (gameState?.round || 1) + 1)
    await set(ref(db, `pictionary-rooms/${roomId}/timeLeft`), ROUND_TIME)
    await set(ref(db, `pictionary-rooms/${roomId}/guessedCorrectly`), false)
    remove(ref(db, `pictionary-rooms/${roomId}/chat`))
    await clearCanvasForAll()
  }

  useEffect(() => {
    if (!gameState || roomId === 'solo' || gameState.status !== 'playing') return
    if (!gameState.guessedCorrectly) return
    if (playerId !== gameState.host) return
    if (advanceRoundRef.current === gameState.round) return
    advanceRoundRef.current = gameState.round
    setTimeout(() => nextRound(), 500)
  }, [gameState?.guessedCorrectly, gameState?.round, gameState?.status, roomId, playerId])

  useEffect(() => {
    if (gameState?.status !== 'playing') return
    if (roomId === 'solo') {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current)
            setChatMessages(msgs => [...msgs, {
              player: 'Sistem',
              message: `⏰ Timpul a expirat! Cuvântul era: ${currentWord}`,
              system: true,
              timestamp: Date.now(),
            }])
            setTimeout(() => nextRoundSolo(), 2000)
            return 0
          }
          return prev - 1
        })
      }, 1000)
      return () => clearInterval(timerRef.current)
    }
  }, [gameState?.status, gameState?.round, roomId])

  useEffect(() => {
    if (!gameState || roomId === 'solo' || gameState.status !== 'playing') return
    if (gameState.guessedCorrectly) return
    const interval = setInterval(async () => {
      const current = await get(ref(db, `pictionary-rooms/${roomId}/timeLeft`))
      const val = current.val()
      if (val && val > 0) {
        await set(ref(db, `pictionary-rooms/${roomId}/timeLeft`), val - 1)
      } else if (val === 0) {
        push(ref(db, `pictionary-rooms/${roomId}/chat`), {
          player: 'Sistem',
          message: `⏰ Timpul a expirat! Cuvântul era: ${gameState.currentWord}`,
          system: true,
          timestamp: Date.now(),
        })
        setTimeout(() => nextRound(), 2000)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [gameState?.status, gameState?.round, gameState?.guessedCorrectly])

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
    if (!roomId || roomId === 'solo') return
    const strokesRef = ref(db, `pictionary-rooms/${roomId}/strokes`)
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
    if (!roomId || roomId === 'solo') return
    const clearRef = ref(db, `pictionary-rooms/${roomId}/clearAt`)
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

  const startDraw = (e) => {
    if (!isDrawing) return
    e.preventDefault()
    drawingRef.current = true
    lastPosRef.current = getCanvasPos(e)
  }

  const draw = (e) => {
    if (!isDrawing) return
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

    if (roomId !== 'solo') {
      const width = canvas.width || 1
      const height = canvas.height || 1
      push(ref(db, `pictionary-rooms/${roomId}/strokes`), {
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
    clearCanvasForAll()
  }

  const cancelSearch = useCallback(() => {
    setSearching(false)
    leaveLobby('pictionary', playerId)
    if (matchUnsubRef.current) {
      matchUnsubRef.current()
      matchUnsubRef.current = null
    }
  }, [playerId])

  const findOnlinePlayer = useCallback(async () => {
    if (!playerName.trim()) return
    setSearching(true)
    const word = getRandomWord()
    const result = await joinLobby('pictionary', playerId, playerName)
    if (result.matched) {
      setSearching(false)
      const roomRef = push(ref(db, 'pictionary-rooms'))
      const newRoomId = roomRef.key
      const initialState = {
        status: 'playing',
        host: playerId,
        hostName: playerName,
        guest: result.playerId,
        guestName: result.playerName,
        hostScore: 0,
        guestScore: 0,
        currentWord: word,
        drawer: playerId,
        round: 1,
        timeLeft: ROUND_TIME,
        guessedCorrectly: false,
      }
      await set(roomRef, initialState)
      await setLobbyMatch('pictionary', result.playerId, {
        roomId: newRoomId,
        host: playerId,
        hostName: playerName,
        guest: result.playerId,
        guestName: result.playerName,
      })
      setRoomId(newRoomId)
      setIsHost(true)
      setJoined(true)
      setCurrentWord(word)
      setIsDrawing(true)
    } else {
      matchUnsubRef.current = listenForLobbyMatch('pictionary', playerId, async (matched) => {
        if (!matched) return
        if (matched.roomId) {
          setSearching(false)
          if (matchUnsubRef.current) {
            matchUnsubRef.current()
            matchUnsubRef.current = null
          }
          await leaveLobby('pictionary', playerId)
          setRoomId(matched.roomId)
          setIsHost(playerId === matched.host)
          setJoined(true)
          setIsDrawing(playerId === matched.host)
          return
        }

        if (playerId > matched.playerId) return

        setSearching(false)
        if (matchUnsubRef.current) {
          matchUnsubRef.current()
          matchUnsubRef.current = null
        }
        await leaveLobby('pictionary', playerId)
        const roomRef = push(ref(db, 'pictionary-rooms'))
        const newRoomId = roomRef.key
        const initialState = {
          status: 'playing',
          host: playerId,
          hostName: playerName,
          guest: matched.playerId,
          guestName: matched.playerName,
          hostScore: 0,
          guestScore: 0,
          currentWord: word,
          drawer: playerId,
          round: 1,
          timeLeft: ROUND_TIME,
          guessedCorrectly: false,
        }
        await set(roomRef, initialState)
        await setLobbyMatch('pictionary', matched.playerId, {
          roomId: newRoomId,
          host: playerId,
          hostName: playerName,
          guest: matched.playerId,
          guestName: matched.playerName,
        })
        setRoomId(newRoomId)
        setIsHost(true)
        setJoined(true)
        setCurrentWord(word)
        setIsDrawing(true)
      })
    }
  }, [playerName, playerId])

  const resetGame = () => {
    if (searching) cancelSearch()
    if (roomId !== 'solo' && roomId) {
      remove(ref(db, `pictionary-rooms/${roomId}`))
    }
    setGameState(null)
    setJoined(false)
    setRoomId('')
    setChatMessages([])
    setCurrentWord('')
    setTimeLeft(ROUND_TIME)
  }

  if (!joined) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <div className="inline-flex p-5 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-800 glow-blue mb-4">
            <Palette className="w-12 h-12 text-white" />
          </div>
          <h1 className="game-title text-2xl text-blue-300 mb-2">DESENEAZĂ & GHICEȘTE</h1>
          <p className="text-gray-400 text-sm">Desenează pe canvas, prietenii ghicesc cuvântul!</p>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="Numele tău..."
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-gray-800/80 border border-blue-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-blue-400"
          />

          <button
            onClick={playSolo}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-700 text-white font-bold hover:from-blue-500 hover:to-cyan-600 transition-all glow-blue"
          >
            🎨 Joacă Solo (Desenează & Ghicește)
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-blue-500/30"></div>
            <span className="text-gray-500 text-xs">SAU MULTIPLAYER</span>
            <div className="flex-1 h-px bg-blue-500/30"></div>
          </div>

          <button
            onClick={findOnlinePlayer}
            disabled={searching || !playerName.trim()}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-pink-600 text-white font-bold hover:from-blue-400 hover:to-pink-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
            className="w-full py-3 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-300 font-bold hover:bg-blue-500/30 transition-all"
          >
            🏠 Creează cameră
          </button>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="ID cameră..."
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="flex-1 px-4 py-3 rounded-xl bg-gray-800/80 border border-blue-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-blue-400"
            />
            <button
              onClick={joinRoom}
              className="px-6 py-3 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-300 font-bold hover:bg-blue-500/30 transition-all"
            >
              Intră
            </button>
          </div>
        </div>
      </div>
    )
  }

  const displayTimeLeft = gameState?.timeLeft ?? timeLeft

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {gameState?.status === 'waiting' && (
        <div className="text-center mb-6 p-6 rounded-xl bg-gray-800/80 border border-blue-500/30">
          <p className="text-blue-300 mb-2">Așteptăm un jucător...</p>
          <p className="text-gray-400 text-sm mb-2">ID cameră:</p>
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
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-yellow-400" />
              <span className={`game-title text-lg ${displayTimeLeft <= 10 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                {displayTimeLeft}s
              </span>
            </div>
          </div>

          {isDrawing && currentWord && (
            <div className="text-center mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
              <span className="text-gray-400 text-sm">Cuvânt de desenat: </span>
              <span className="game-title text-lg text-blue-300">{currentWord}</span>
            </div>
          )}

          {isDrawing && (
            <div className="mb-3 flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="Setează cuvântul (opțional)..."
                value={customWord}
                onChange={(e) => setCustomWord(e.target.value)}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-800/80 border border-blue-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-blue-400 text-sm"
              />
              <button
                onClick={applyCustomWord}
                className="px-4 py-2 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-all text-sm"
              >
                Setează
              </button>
            </div>
          )}

          {!isDrawing && (
            <div className="text-center mb-4 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
              <span className="text-orange-300 text-sm">Tu ghicești! Privește desenul și scrie răspunsul.</span>
              <span className="text-gray-400 text-sm ml-2">
                ({gameState.currentWord?.length} litere: {gameState.currentWord?.split('').map(() => '_ ').join('')})
              </span>
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
                  <p className="text-gray-600 text-xs">Niciun mesaj încă...</p>
                )}
              </div>

              {!isDrawing && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Ghicește cuvântul..."
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
            Ieși din joc
          </button>
        </>
      )}
    </div>
  )
}
