import { useState, useEffect, useCallback, useRef } from 'react'
import { ref, set, onValue, push, remove, get } from 'firebase/database'
import { db } from '../../firebase'
import { joinLobby, leaveLobby, listenForLobbyMatch, setLobbyMatch, createRoomWithGuest, getRoomPath } from '../../utils/matchmaking'
import { Zap, Eye, Swords, RotateCcw, Trophy, Heart, Sparkles, Search } from 'lucide-react'

const CHOICES = { ROCK: 'rock', PAPER: 'paper', SCISSORS: 'scissors' }
const SKILLS = { PREVIZIUNE: 'previziune', DUBLU_ATACT: 'dublu_atac' }
const MAX_ENERGY = 100
const ENERGY_REGEN = 15
const SKILL_COSTS = { previziune: 25, dublu_atac: 40 }
const WIN_SCORE = 5

const choiceEmojis = { rock: '🪨', paper: '📄', scissors: '✂️' }
const choiceNames = { rock: 'Piatră', paper: 'Hârtie', scissors: 'Foarfece' }

function getWinner(p1, p2) {
  if (p1 === p2) return 'draw'
  if (
    (p1 === 'rock' && p2 === 'scissors') ||
    (p1 === 'paper' && p2 === 'rock') ||
    (p1 === 'scissors' && p2 === 'paper')
  ) return 'p1'
  return 'p2'
}

export default function RPSTactic() {
  const [playerId] = useState(() => 'p_' + Math.random().toString(36).substr(2, 9))
  const [playerName, setPlayerName] = useState('')
  const [joined, setJoined] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [gameState, setGameState] = useState(null)
  const [selectedChoice, setSelectedChoice] = useState(null)
  const [locked, setLocked] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const [previziuneUsed, setPreviziuneUsed] = useState(false)
  const [opponentLastChoice, setOpponentLastChoice] = useState(null)
  const [gameLog, setGameLog] = useState([])
  const [waitingForOpponent, setWaitingForOpponent] = useState(false)
  const [searching, setSearching] = useState(false)
  const matchUnsubRef = useRef(null)

  const createRoom = async () => {
    if (!playerName.trim()) return
    const roomRef = push(ref(db, 'rps-rooms'))
    const newRoomId = roomRef.key
    const initialState = {
      status: 'waiting',
      host: playerId,
      hostName: playerName,
      guest: '',
      guestName: '',
      hostScore: 0,
      guestScore: 0,
      hostEnergy: MAX_ENERGY,
      guestEnergy: MAX_ENERGY,
      hostChoice: '',
      guestChoice: '',
      hostLastChoice: '',
      guestLastChoice: '',
      round: 0,
      winner: '',
    }
    await set(roomRef, initialState)
    setRoomId(newRoomId)
    setIsHost(true)
    setJoined(true)
  }

  const joinRoom = async () => {
    if (!playerName.trim() || !roomId.trim()) return
    const roomRef = ref(db, `rps-rooms/${roomId}`)
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
    await set(ref(db, `rps-rooms/${roomId}/guest`), playerId)
    await set(ref(db, `rps-rooms/${roomId}/guestName`), playerName)
    await set(ref(db, `rps-rooms/${roomId}/status`), 'playing')
    setJoined(true)
    setIsHost(false)
  }

  const playVsAI = () => {
    if (!playerName.trim()) return
    setRoomId('ai')
    setIsHost(true)
    setJoined(true)
    setGameState({
      status: 'playing',
      host: playerId,
      hostName: playerName,
      guest: 'ai',
      guestName: '🤖 AI Bot',
      hostScore: 0,
      guestScore: 0,
      hostEnergy: MAX_ENERGY,
      guestEnergy: MAX_ENERGY,
      hostChoice: '',
      guestChoice: '',
      hostLastChoice: '',
      guestLastChoice: '',
      round: 0,
      winner: '',
    })
  }

  useEffect(() => {
    if (!joined || roomId === 'ai') return
    const roomRef = ref(db, `rps-rooms/${roomId}`)
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val()
        setGameState(data)
        if (data.hostChoice && data.guestChoice && data.hostChoice !== '' && data.guestChoice !== '') {
          setShowResult(true)
          setTimeout(() => {
            setShowResult(false)
            setSelectedChoice(null)
            setLocked(false)
            setPreviziuneUsed(false)
            setOpponentLastChoice(null)
            setWaitingForOpponent(false)
          }, 2500)
        }
      }
    })
    return () => unsubscribe()
  }, [joined, roomId])

  const useSkill = useCallback((skill) => {
    if (!gameState || locked) return
    const myEnergy = isHost ? gameState.hostEnergy : gameState.guestEnergy
    const cost = SKILL_COSTS[skill]
    if (myEnergy < cost) {
      alert('Nu ai suficientă energie!')
      return
    }
    if (skill === SKILLS.PREVIZIUNE) {
      const oppLast = isHost ? gameState.guestLastChoice : gameState.hostLastChoice
      if (!oppLast) {
        alert('Oponentul nu are încă o ultimă alegere!')
        return
      }
      setOpponentLastChoice(oppLast)
      setPreviziuneUsed(true)
      const newEnergy = myEnergy - cost
      if (roomId !== 'ai') {
        set(ref(db, `rps-rooms/${roomId}/${isHost ? 'host' : 'guest'}Energy`), newEnergy)
      } else {
        setGameState(prev => ({
          ...prev,
          [isHost ? 'hostEnergy' : 'guestEnergy']: newEnergy
        }))
      }
    }
  }, [gameState, isHost, locked, roomId])

  const makeChoice = useCallback(async (choice) => {
    if (locked || !gameState || gameState.status !== 'playing') return
    setSelectedChoice(choice)
    setLocked(true)

    if (roomId === 'ai') {
      const aiChoices = ['rock', 'paper', 'scissors']
      const aiChoice = aiChoices[Math.floor(Math.random() * aiChoices.length)]
      const myEnergy = gameState.hostEnergy
      const result = getWinner(choice, aiChoice)
      let newHostScore = gameState.hostScore
      let newGuestScore = gameState.guestScore
      if (result === 'p1') newHostScore++
      if (result === 'p2') newGuestScore++
      const newEnergy = Math.min(MAX_ENERGY, myEnergy - 5 + ENERGY_REGEN)
      const logEntry = `R${gameState.round + 1}: Tu ${choiceEmojis[choice]} vs AI ${choiceEmojis[aiChoice]} — ${result === 'p1' ? '✅ Câștigi' : result === 'p2' ? '❌ Pierzi' : '🤝 Egal'}`
      setGameLog(prev => [...prev, logEntry])
      setShowResult(true)
      const gameWinner = newHostScore >= WIN_SCORE ? 'host' : newGuestScore >= WIN_SCORE ? 'guest' : ''
      setGameState(prev => ({
        ...prev,
        hostChoice: choice,
        guestChoice: aiChoice,
        hostLastChoice: choice,
        guestLastChoice: aiChoice,
        hostScore: newHostScore,
        guestScore: newGuestScore,
        hostEnergy: newEnergy,
        guestEnergy: MAX_ENERGY,
        round: prev.round + 1,
        winner: gameWinner,
        status: gameWinner ? 'finished' : 'playing',
      }))
      setTimeout(() => {
        setShowResult(false)
        setSelectedChoice(null)
        setLocked(false)
        setPreviziuneUsed(false)
        setOpponentLastChoice(null)
      }, 2500)
      return
    }

    const playerKey = isHost ? 'host' : 'guest'
    await set(ref(db, `rps-rooms/${roomId}/${playerKey}Choice`), choice)
    setWaitingForOpponent(true)
  }, [locked, gameState, isHost, roomId])

  const cancelSearch = useCallback(() => {
    setSearching(false)
    leaveLobby('rps-tactic', playerId)
    if (matchUnsubRef.current) {
      matchUnsubRef.current()
      matchUnsubRef.current = null
    }
  }, [playerId])

  const findOnlinePlayer = useCallback(async () => {
    if (!playerName.trim()) return
    setSearching(true)
    const result = await joinLobby('rps-tactic', playerId, playerName)
    if (result.matched) {
      setSearching(false)
      const roomRef = push(ref(db, 'rps-rooms'))
      const newRoomId = roomRef.key
      const initialState = {
        status: 'playing',
        host: playerId,
        hostName: playerName,
        guest: result.playerId,
        guestName: result.playerName,
        hostScore: 0,
        guestScore: 0,
        hostEnergy: MAX_ENERGY,
        guestEnergy: MAX_ENERGY,
        hostChoice: '',
        guestChoice: '',
        hostLastChoice: '',
        guestLastChoice: '',
        round: 0,
        winner: '',
      }
      await set(roomRef, initialState)
      await setLobbyMatch('rps-tactic', result.playerId, {
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
      matchUnsubRef.current = listenForLobbyMatch('rps-tactic', playerId, async (matched) => {
        if (!matched) return
        if (matched.roomId) {
          setSearching(false)
          if (matchUnsubRef.current) {
            matchUnsubRef.current()
            matchUnsubRef.current = null
          }
          await leaveLobby('rps-tactic', playerId)
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
        await leaveLobby('rps-tactic', playerId)
        const roomRef = push(ref(db, 'rps-rooms'))
        const newRoomId = roomRef.key
        const initialState = {
          status: 'playing',
          host: playerId,
          hostName: playerName,
          guest: matched.playerId,
          guestName: matched.playerName,
          hostScore: 0,
          guestScore: 0,
          hostEnergy: MAX_ENERGY,
          guestEnergy: MAX_ENERGY,
          hostChoice: '',
          guestChoice: '',
          hostLastChoice: '',
          guestLastChoice: '',
          round: 0,
          winner: '',
        }
        await set(roomRef, initialState)
        await setLobbyMatch('rps-tactic', matched.playerId, {
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

  const resetGame = () => {
    if (searching) cancelSearch()
    setGameState(null)
    setJoined(false)
    setRoomId('')
    setSelectedChoice(null)
    setLocked(false)
    setShowResult(false)
    setPreviziuneUsed(false)
    setOpponentLastChoice(null)
    setGameLog([])
    setWaitingForOpponent(false)
    if (roomId !== 'ai' && roomId) {
      remove(ref(db, `rps-rooms/${roomId}`))
    }
  }

  if (!joined) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <div className="inline-flex p-5 rounded-2xl bg-gradient-to-br from-purple-600 to-violet-800 glow-purple mb-4">
            <Zap className="w-12 h-12 text-white" />
          </div>
          <h1 className="game-title text-2xl text-purple-300 mb-2">RPS TACTIC</h1>
          <p className="text-gray-400 text-sm">Rock Paper Scissors cu strategie și skill-uri</p>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="Numele tău..."
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-gray-800/80 border border-purple-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-purple-400"
          />

          <button
            onClick={playVsAI}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-violet-700 text-white font-bold hover:from-purple-500 hover:to-violet-600 transition-all glow-purple"
          >
            🤖 Joacă vs AI
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-purple-500/30"></div>
            <span className="text-gray-500 text-xs">SAU MULTIPLAYER</span>
            <div className="flex-1 h-px bg-purple-500/30"></div>
          </div>

          <button
            onClick={findOnlinePlayer}
            disabled={searching || !playerName.trim()}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-600 text-white font-bold hover:from-purple-400 hover:to-pink-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
            className="w-full py-3 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 font-bold hover:bg-purple-500/30 transition-all"
          >
            🏠 Creează cameră
          </button>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="ID cameră..."
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="flex-1 px-4 py-3 rounded-xl bg-gray-800/80 border border-purple-500/30 text-white placeholder-gray-500 focus:outline-none focus:border-purple-400"
            />
            <button
              onClick={joinRoom}
              className="px-6 py-3 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 font-bold hover:bg-purple-500/30 transition-all"
            >
              Intră
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!gameState) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <div className="animate-pulse text-purple-400 text-lg">Se încarcă...</div>
        {isHost && roomId !== 'ai' && (
          <div className="mt-6 p-4 rounded-xl bg-gray-800/80 border border-purple-500/30">
            <p className="text-gray-400 text-sm mb-2">ID cameră:</p>
            <p className="game-title text-lg text-purple-300 break-all">{roomId}</p>
            <p className="text-gray-500 text-xs mt-2">Trimite acest ID prietenului tău</p>
          </div>
        )}
      </div>
    )
  }

  const myEnergy = isHost ? gameState.hostEnergy : gameState.guestEnergy
  const oppEnergy = isHost ? gameState.guestEnergy : gameState.hostEnergy
  const myScore = isHost ? gameState.hostScore : gameState.guestScore
  const oppScore = isHost ? gameState.guestScore : gameState.hostScore
  const myName = isHost ? gameState.hostName : gameState.guestName
  const oppName = isHost ? gameState.guestName : gameState.hostName
  const myChoice = isHost ? gameState.hostChoice : gameState.guestChoice
  const oppChoice = isHost ? gameState.guestChoice : gameState.hostChoice

  const result = (myChoice && oppChoice) ? getWinner(myChoice, oppChoice) : null

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {gameState.status === 'waiting' && (
        <div className="text-center mb-8 p-6 rounded-xl bg-gray-800/80 border border-purple-500/30">
          <p className="text-purple-300 mb-2">Așteptăm un jucător...</p>
          <p className="text-gray-400 text-sm mb-2">ID cameră:</p>
          <p className="game-title text-lg text-purple-300 break-all">{roomId}</p>
        </div>
      )}

      {gameState.status === 'finished' && (
        <div className="text-center mb-8 p-6 rounded-xl bg-gradient-to-br from-purple-600/20 to-violet-800/20 border border-purple-500/30">
          <Trophy className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
          <h2 className="game-title text-xl text-yellow-300 mb-2">
            {gameState.winner === (isHost ? 'host' : 'guest') ? '🎉 AI CÂȘTIGAT!' : '😢 AI PIERDUT!'}
          </h2>
          <p className="text-gray-400 mb-4">
            Scor final: {myScore} - {oppScore}
          </p>
          <button
            onClick={resetGame}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-violet-700 text-white font-bold hover:from-purple-500 hover:to-violet-600 transition-all"
          >
            <RotateCcw className="w-5 h-5 inline mr-2" />
            Joacă din nou
          </button>
        </div>
      )}

      {gameState.status !== 'waiting' && (
        <>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-gray-800/80 border border-purple-500/30 text-center">
              <p className="text-purple-300 font-bold text-sm">{myName} (Tu)</p>
              <p className="game-title text-2xl text-white my-2">{myScore}</p>
              <div className="flex items-center gap-1 justify-center">
                <Zap className="w-4 h-4 text-yellow-400" />
                <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full transition-all"
                    style={{ width: `${(myEnergy / MAX_ENERGY) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400">{myEnergy}</span>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-gray-800/80 border border-red-500/30 text-center">
              <p className="text-red-300 font-bold text-sm">{oppName}</p>
              <p className="game-title text-2xl text-white my-2">{oppScore}</p>
              <div className="flex items-center gap-1 justify-center">
                <Zap className="w-4 h-4 text-yellow-400" />
                <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-red-400 to-pink-500 rounded-full transition-all"
                    style={{ width: `${(oppEnergy / MAX_ENERGY) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400">{oppEnergy}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2 mb-6 justify-center">
            <button
              onClick={() => useSkill(SKILLS.PREVIZIUNE)}
              disabled={locked || myEnergy < SKILL_COSTS.previziune || previziuneUsed}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                previziuneUsed
                  ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                  : locked || myEnergy < SKILL_COSTS.previziune
                  ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                  : 'bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30'
              }`}
            >
              <Eye className="w-4 h-4" />
              Previziune ({SKILL_COSTS.previziune}⚡)
            </button>
            <button
              disabled={true}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-700/50 text-gray-500 cursor-not-allowed border border-gray-600/30"
              title="Dublu Atac - în curând"
            >
              <Swords className="w-4 h-4" />
              Dublu Atac ({SKILL_COSTS.dublu_atac}⚡)
            </button>
          </div>

          {previziuneUsed && opponentLastChoice && (
            <div className="text-center mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
              <Eye className="w-4 h-4 inline text-green-400 mr-2" />
              <span className="text-green-300 text-sm">
                Ultima alegere oponent: <strong>{choiceNames[opponentLastChoice]} {choiceEmojis[opponentLastChoice]}</strong>
              </span>
            </div>
          )}

          {showResult && myChoice && oppChoice && (
            <div className="text-center mb-6 p-6 rounded-xl bg-gray-800/80 border border-purple-500/30">
              <div className="flex items-center justify-center gap-8 mb-4">
                <div className="text-5xl animate-float">{choiceEmojis[myChoice]}</div>
                <span className="text-2xl text-gray-500 font-bold">VS</span>
                <div className="text-5xl animate-float" style={{ animationDelay: '0.5s' }}>{choiceEmojis[oppChoice]}</div>
              </div>
              <p className={`game-title text-lg ${
                result === 'p1' && isHost || result === 'p2' && !isHost
                  ? 'text-green-400'
                  : result === 'draw'
                  ? 'text-yellow-400'
                  : 'text-red-400'
              }`}>
                {result === 'draw'
                  ? '🤝 EGAL!'
                  : (result === 'p1' && isHost) || (result === 'p2' && !isHost)
                  ? '✅ CÂȘTIGI!'
                  : '❌ PIERZI!'}
              </p>
            </div>
          )}

          {waitingForOpponent && !showResult && (
            <div className="text-center mb-6 p-4 rounded-lg bg-purple-500/10 border border-purple-500/30">
              <p className="text-purple-300 animate-pulse">Așteptăm alegerea oponentului...</p>
            </div>
          )}

          {!locked && gameState.status === 'playing' && (
            <div className="flex justify-center gap-4 mb-6">
              {Object.values(CHOICES).map((choice) => (
                <button
                  key={choice}
                  onClick={() => makeChoice(choice)}
                  className="card-hover flex flex-col items-center gap-2 p-6 rounded-2xl bg-gray-800/80 border border-purple-500/30 hover:border-purple-400 hover:bg-purple-500/10 transition-all"
                >
                  <span className="text-4xl">{choiceEmojis[choice]}</span>
                  <span className="text-sm text-gray-300 font-medium">{choiceNames[choice]}</span>
                </button>
              ))}
            </div>
          )}

          {locked && !showResult && (
            <div className="text-center mb-6">
              <p className="text-purple-300">Ai ales: <span className="text-3xl">{choiceEmojis[selectedChoice]}</span></p>
            </div>
          )}

          {gameLog.length > 0 && (
            <div className="mt-6 p-4 rounded-xl bg-gray-900/80 border border-gray-700/30 max-h-40 overflow-y-auto">
              <p className="text-xs text-gray-500 mb-2 font-bold">ISTORIC</p>
              {gameLog.map((entry, i) => (
                <p key={i} className="text-xs text-gray-400 py-0.5">{entry}</p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
