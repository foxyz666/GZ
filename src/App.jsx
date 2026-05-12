import { Routes, Route } from 'react-router-dom'
import Home from './components/Home'
import Skribbl from './games/pictionary/Pictionary'
import TicTacToe from './games/tictactoe/TicTacToe'
import Navbar from './components/Navbar'

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f0f1a] via-[#1a1a2e] to-[#16213e]">
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/skribbl" element={<Skribbl />} />
        <Route path="/tictactoe" element={<TicTacToe />} />
      </Routes>
    </div>
  )
}

export default App
