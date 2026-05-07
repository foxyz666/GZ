import { useState, useEffect, useRef, useCallback } from 'react'
import { ref, set, onValue, push, remove, get } from 'firebase/database'
import { db } from '../../firebase'
import { joinLobby, leaveLobby, listenForLobbyMatch, setLobbyMatch } from '../../utils/matchmaking'
import { MessageCircle, Send, RotateCcw, Sparkles, Laugh, Search } from 'lucide-react'

const STARTERS = [
  'Dacă aș fi un robot, aș...',
  'Când voi ajunge pe Marte, voi...',
  'Dacă aș putea fi invizibil, aș...',
  'Cel mai ciudat lucru pe care l-am văzut a fost...',
  'Dacă aș fi un supererou, puterea mea ar fi...',
  'Când vaca zboară, ea...',
  'Dacă pisicile ar putea vorbi, ar spune...',
  'Cel mai amuzant vis pe care l-am avut a fost despre...',
  'Dacă aș trăi în ocean, aș...',
  'Când extraterestrii vor veni pe Pământ, ei vor...',
  'Dacă aș fi un aliment, aș fi...',
  'Cel mai bun superputere pentru un leneș ar fi...',
  'Dacă aș fi un animal mitologic, aș fi...',
  'Când calculatorul meu prinde viață, el...',
  'Dacă aș putea călători în timp, aș merge...',
  'Cel mai ciudat lucru pe care l-aș face cu o mașină zburătoare ar fi...',
  'Dacă aș fi un emoji, aș fi...',
  'Când voi câștiga la loto, voi...',
  'Dacă aș putea schimba o regulă, aș schimba...',
  'Cel mai haotic lucru pe care l-aș face cu magie ar fi...',
]

export default function FinishSentence() {
  const [playerId] = useState(() => 'p_' + Math.random().toString(36).substr(2, 9))
  const [playerName, setPlayerName] = useState('')
  const [joined, setJoined] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [gameState, setGameState] = useState(null)
  const [continuation, setContinuation] = useState('')
  const [sentences, setSentences] = useState([])
  const [currentStarter, setCurrentStarter] = useState('')
  const [searching, setSearching] = useState(false)
  const matchUnsubRef = useRef(null)
  const chatEndRef = useRef(null)

  const getRandomStarter = () => STARTERS[Math.floor(Math.random() * STARTERS.length)]

  const createRoom = async () => {
    if (!playerName.trim()) return
    const starter = getRandomStarter()
    const roomRef = push(ref(db, 'sentence-rooms'))
    const newRoomId = roomRef.key
    await set(roomRef, {
      status: 'waiting',
      host: playerId,
      hostName: playerName,
      guest: '',
      guestName: '',
      currentStarter: starter,
      turn: playerId,
    })
    setRoomId(newRoomId)
    setIsHost(true)
    setJoined(true)
    setCurrentStarter(starter)
  }

  const joinRoom = async () => {
    if (!playerName.trim() || !roomId.trim()) return
    const roomRef = ref(db, `sentence-rooms/${roomId}`)
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
    await set(ref(db, `sentence-rooms/${roomId}/guest`), playerId)
    await set(ref(db, `sentence-rooms/${roomId}/guestName`), playerName)
    await set(ref(db, `sentence-rooms/${roomId}/status`), 'playing')
    setJoined(true)
    setIsHost(false)
    setCurrentStarter(data.currentStarter)
  }

  const playSolo = () => {
    if (!playerName.trim()) return
    const starter = getRandomStarter()
    setRoomId('solo')
    setIsHost(true)
    setJoined(true)
    setCurrentStarter(starter)
    setGameState({
      status: 'playing',
      host: playerId,
      hostName: playerName,
      currentStarter: starter,
      turn: playerId,
    })
  }

  useEffect(() => {
    if (!joined || roomId === 'solo') return
    const roomRef = ref(db, `sentence-rooms/${roomId}`)
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val()
        setGameState(data)
        setCurrentStarter(data.currentStarter)
      }
    })
    return () => unsubscribe()
  }, [joined, roomId])

  useEffect(() => {
    if (!joined || roomId === 'solo') return
    const sentencesRef = ref(db, `sentence-rooms/${roomId}/sentences`)
    const unsubscribe = onValue(sentencesRef, (snapshot) => {
      if (snapshot.exists()) {
        const entries = Object.values(snapshot.val())
        setSentences(entries.sort((a, b) => a.timestamp - b.timestamp))
      } else {
        setSentences([])
      }
    })
    return () => unsubscribe()
  }, [joined, roomId])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [sentences])

  const sendContinuation = async () => {
    if (!continuation.trim()) return

    if (roomId === 'solo') {
      const newEntry = {
        player: playerName,
        text: continuation,
        timestamp: Date.now(),
      }
      setSentences(prev => [...prev, newEntry])
      setContinuation('')
      return
    }

    if (gameState?.turn !== playerId) {
      alert('Nu e rândul tău!')
      return
    }

    await push(ref(db, `sentence-rooms/${roomId}/sentences`), {
      player: playerName,
      text: continuation,
      timestamp: Date.now(),
    })

    const nextTurn = gameState.turn === gameState.host ? gameState.guest : gameState.host
    await set(ref(db, `sentence-rooms/${roomId}/turn`), nextTurn)
    setContinuation('')
  }

  const newStarter = async () => {
    const starter = getRandomStarter()
    if (roomId === 'solo') {
      setCurrentStarter(starter)
      setSentences([])
      setGameState(prev => ({ ...prev, currentStarter: starter }))
      return
    }
    await set(ref(db, `sentence-rooms/${roomId}/currentStarter`), starter)
    await remove(ref(db, `sentence-rooms/${roomId}/sentences`))
  }

  const cancelSearch = useCallback(() => {
    setSearching(false)
    leaveLobby('finish-sentence', playerId)
    if (matchUnsubRef.current) {
      matchUnsubRef.current()
      matchUnsubRef.current = null
    }
  }, [playerId])

  const findOnlinePlayer = useCallback(async () => {
    if (!playerName.trim()) return
    setSearching(true)
    const starter = getRandomStarter()
    const result = await joinLobby('finish-sentence', playerId, playerName)
    if (result.matched) {
      setSearching(false)
      const roomRef = push(ref(db, 'sentence-rooms'))
      const newRoomId = roomRef.key
      await set(roomRef, {
        status: 'playing',
        host: playerId,
        hostName: playerName,
        guest: result.playerId,
        guestName: result.playerName,
        currentStarter: starter,
        turn: playerId,
      })
      await setLobbyMatch('finish-sentence', result.playerId, {
        roomId: newRoomId,
        host: playerId,
        hostName: playerName,
        guest: result.playerId,
        guestName: result.playerName,
      })
      setRoomId(newRoomId)
      setIsHost(true)
      setJoined(true)
      setCurrentStarter(starter)
    } else {
      matchUnsubRef.current = listenForLobbyMatch('finish-sentence', playerId, async (matched) => {
        if (!matched) return
        if (matched.roomId) {
          setSearching(false)
          if (matchUnsubRef.current) {
            matchUnsubRef.current()
            matchUnsubRef.current = null
          }
          await leaveLobby('finish-sentence', playerId)
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
        await leaveLobby('finish-sentence', playerId)
        const roomRef = push(ref(db, 'sentence-rooms'))
        const newRoomId = roomRef.key
        await set(roomRef, {
          status: 'playing',
          host: playerId,
          hostName: playerName,
          guest: matched.playerId,
          guestName: matched.playerName,
          currentStarter: starter,
          turn: playerId,
        })
        await setLobbyMatch('finish-sentence', matched.playerId, {
          roomId: newRoomId,
          host: playerId,
          hostName: playerName,
          guest: matched.playerId,
          guestName: matched.playerName,
        })
        setRoomId(newRoomId)
        setIsHost(true)
        setJoined(true)
        setCurrentStarter(starter)
      })
    }
  }, [playerName, playerId])

  const resetGame = () => {
    if (searching) cancelSearch()
    if (roomId !== 'solo' && roomId) {
      remove(ref(db, `sentence-rooms/${roomId}`))
    }
    setGameState(null)
    setJoined(false)
    setRoomId('')
    setSentences([])
    setContinuation('')
    setCurrentStarter('')
  }

  const isMyTurn = gameState?.turn === playerId

  if (!joined) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <div className="inline-flex p-5 rounded-2xl bg-gradient-to-br from-orange-600 to-amber-800 glow-orange mb-4">
            <MessageCircle className="w-12 h-12 text-white" />
          </div>
          <h1 className="game-title text-2xl text-orange-300 mb-2">FINISH THE SENTENCE</h1>
          <p className="text-gray-400 text-sm">Improvisation comedy! Continuă propoziția și devine haotic!</p>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="Numele tău..."
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-gray-800/80 border border-orange-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-orange-400"
          />

          <button
            onClick={playSolo}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-600 to-amber-700 text-white font-bold hover:from-orange-500 hover:to-amber-600 transition-all glow-orange"
          >
            😂 Joacă Solo
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-orange-500/30"></div>
            <span className="text-gray-500 text-xs">SAU MULTIPLAYER</span>
            <div className="flex-1 h-px bg-orange-500/30"></div>
          </div>

          <button
            onClick={findOnlinePlayer}
            disabled={searching || !playerName.trim()}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-pink-600 text-white font-bold hover:from-orange-400 hover:to-pink-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
            className="w-full py-3 rounded-xl bg-orange-500/20 border border-orange-500/30 text-orange-300 font-bold hover:bg-orange-500/30 transition-all"
          >
            🏠 Creează cameră
          </button>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="ID cameră..."
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="flex-1 px-4 py-3 rounded-xl bg-gray-800/80 border border-orange-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-orange-400"
            />
            <button
              onClick={joinRoom}
              className="px-6 py-3 rounded-xl bg-orange-500/20 border border-orange-500/30 text-orange-300 font-bold hover:bg-orange-500/30 transition-all"
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
        <div className="text-center mb-8 p-6 rounded-xl bg-gray-800/80 border border-orange-500/30">
          <p className="text-orange-300 mb-2">Așteptăm un jucător...</p>
          <p className="text-gray-400 text-sm mb-2">ID cameră:</p>
          <p className="game-title text-lg text-orange-300 break-all">{roomId}</p>
        </div>
      )}

      {gameState?.status === 'playing' && (
        <>
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30 mb-4">
              <Laugh className="w-5 h-5 text-orange-400" />
              <span className="text-orange-300 text-sm font-bold">IMPROV COMEDY</span>
            </div>
          </div>

          <div className="p-6 rounded-xl bg-gradient-to-br from-orange-600/10 to-amber-800/10 border border-orange-500/30 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-5 h-5 text-orange-400" />
              <span className="text-orange-300 text-sm font-bold">PROPUNERE:</span>
            </div>
            <p className="game-title text-lg text-white leading-relaxed">
              {currentStarter}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-gray-800/80 border border-gray-700/30 mb-4 max-h-72 overflow-y-auto">
            {sentences.length === 0 && (
              <p className="text-gray-600 text-sm text-center">Continuă propoziția de mai sus...</p>
            )}
            {sentences.map((entry, i) => (
              <div key={i} className="py-2 border-b border-gray-700/20 last:border-0">
                <span className="text-orange-300 font-bold text-sm">{entry.player}:</span>{' '}
                <span className="text-gray-300 text-sm">{entry.text}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {roomId !== 'solo' && (
            <div className="text-center mb-4">
              <span className={`text-sm px-3 py-1 rounded-full ${
                isMyTurn
                  ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                  : 'bg-gray-700/50 text-gray-500 border border-gray-600/30'
              }`}>
                {isMyTurn ? '✍️ E rândul tău!' : '⏳ Așteaptă rândul tău...'}
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              placeholder={roomId === 'solo' ? 'Continuă propoziția...' : (isMyTurn ? 'Continuă propoziția...' : 'Așteaptă...')}
              value={continuation}
              onChange={(e) => setContinuation(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (roomId === 'solo' || isMyTurn) && sendContinuation()}
              disabled={roomId !== 'solo' && !isMyTurn}
              className="flex-1 px-4 py-3 rounded-xl bg-gray-800/80 border border-orange-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-orange-400 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              onClick={sendContinuation}
              disabled={roomId !== 'solo' && !isMyTurn}
              className="p-3 rounded-xl bg-orange-500/20 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>

          <div className="flex gap-3 mt-6 justify-center">
            <button
              onClick={newStarter}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-300 text-sm hover:bg-orange-500/30 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              Propunere nouă
            </button>
            <button
              onClick={resetGame}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700/50 text-gray-400 text-sm hover:bg-gray-700 transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              Ieși din joc
            </button>
          </div>
        </>
      )}
    </div>
  )
}
