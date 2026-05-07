import { Routes, Route } from 'react-router-dom'
import Home from './components/Home'
import RPSTactic from './games/rps-tactic/RPSTactic'
import Pictionary from './games/pictionary/Pictionary'
import MemoryGame from './games/memory/MemoryGame'
import FinishSentence from './games/finish-sentence/FinishSentence'
import Navbar from './components/Navbar'

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f0f1a] via-[#1a1a2e] to-[#16213e]">
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rps-tactic" element={<RPSTactic />} />
        <Route path="/pictionary" element={<Pictionary />} />
        <Route path="/memory" element={<MemoryGame />} />
        <Route path="/finish-sentence" element={<FinishSentence />} />
      </Routes>
    </div>
  )
}

export default App
