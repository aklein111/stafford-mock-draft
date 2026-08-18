import { useState } from 'react'
import { draftData } from './sim/data'
import { DraftScreen } from './ui/DraftScreen'

export default function App() {
  // A fresh random seed per session for now. Phase 6 adds a visible seed
  // and a "restart with same seed" control per spec §5's Pacing section.
  const [seed] = useState(() => Date.now())
  return <DraftScreen data={draftData} seed={seed} />
}
