import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Palette, ChevronRight, Users } from 'lucide-react'
import { listenForPlayerCount } from '../utils/matchmaking'

const games = [
  {
    id: 'skribbl',
    title: 'Skribbl de prieteni',
    subtitle: 'SKRIBBL',
    description: 'Desenează pe rând și ghiciți cuvintele. Camere private sau matchmaking rapid.',
    icon: Palette,
    color: 'blue',
    gradient: 'from-blue-600 to-cyan-800',
    glowClass: 'glow-blue',
    path: '/skribbl',
    features: ['Cuvinte la alegere', 'Chat live', 'Timer + Scor'],
  },
]

const colorMap = {
  blue: {
    bg: 'bg-blue-500/20',
    text: 'text-blue-300',
    border: 'border-blue-500/30',
    hoverBg: 'hover:bg-blue-500/30',
    tag: 'bg-blue-500/30 text-blue-200',
  },
}

export default function Home() {
  const [playerCounts, setPlayerCounts] = useState({})

  useEffect(() => {
    const unsubscribers = games.map((game) => {
      return listenForPlayerCount(game.id, (count) => {
        setPlayerCounts((prev) => ({ ...prev, [game.id]: count }))
      })
    })
    return () => unsubscribers.forEach((unsub) => unsub())
  }, [])

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="text-center mb-16">
        <h1 className="game-title text-4xl md:text-5xl text-purple-300 mb-4 animate-pulse-glow">
          GAME ZONE
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto">
          Joc tip skribbl pentru prieteni: desenezi, ghicești și schimbi runde rapid.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {games.map((game) => {
          const Icon = game.icon
          const colors = colorMap[game.color]
          const count = playerCounts[game.id] || 0
          return (
            <Link
              key={game.id}
              to={game.path}
              className={`card-hover block rounded-2xl border ${colors.border} ${colors.bg} backdrop-blur-sm overflow-hidden group`}
            >
              <div className="p-8">
                <div className="flex items-start justify-between mb-6">
                  <div className={`p-4 rounded-xl bg-gradient-to-br ${game.gradient} ${game.glowClass}`}>
                    <Icon className="w-8 h-8 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${colors.bg} border ${colors.border}`}>
                      <Users className="w-4 h-4" />
                      <span className="text-sm font-bold">{count}</span>
                    </div>
                    <ChevronRight className={`w-6 h-6 ${colors.text} opacity-0 group-hover:opacity-100 transition-opacity`} />
                  </div>
                </div>

                <p className={`text-xs font-bold tracking-widest ${colors.text} mb-1`}>
                  {game.subtitle}
                </p>
                <h2 className="text-2xl font-extrabold text-white mb-3">
                  {game.title}
                </h2>
                <p className="text-gray-400 text-sm leading-relaxed mb-6">
                  {game.description}
                </p>

                <div className="flex flex-wrap gap-2">
                  {game.features.map((feat) => (
                    <span key={feat} className={`px-3 py-1 rounded-full text-xs font-medium ${colors.tag}`}>
                      {feat}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      <div className="text-center mt-16">
        <p className="text-gray-500 text-sm">
          Mai multe îmbunătățiri în curând... 🎮
        </p>
      </div>
    </div>
  )
}
