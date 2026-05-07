import { Link, useLocation } from 'react-router-dom'
import { Gamepad2, Home } from 'lucide-react'

export default function Navbar() {
  const location = useLocation()
  const isHome = location.pathname === '/'

  return (
    <nav className="sticky top-0 z-50 backdrop-blur-md bg-[#0f0f1a]/80 border-b border-purple-500/20">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <Gamepad2 className="w-7 h-7 text-purple-400 group-hover:text-purple-300 transition-colors" />
          <span className="game-title text-lg text-purple-300 group-hover:text-purple-200 transition-colors">
            GAME ZONE
          </span>
        </Link>
        {!isHome && (
          <Link
            to="/"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 transition-all text-sm font-medium"
          >
            <Home className="w-4 h-4" />
            Toate jocurile
          </Link>
        )}
      </div>
    </nav>
  )
}
