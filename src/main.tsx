import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import PetApp from './PetApp.tsx'

// One bundle, two windows. The Electron main process loads the same file with
// #pet or #popover, so there is nothing extra to build or keep in sync.
const isPet = window.location.hash === '#pet'

// Which window this is, on the root element.
//
// One bundle means ONE stylesheet, so PetApp.css's "paint nothing" rule for the
// transparent pet window also landed on the popover — and being later in the
// bundle, it won. The popover's own `background: var(--bg)` was dead the whole
// time. Invisible in light mode, where --bg is a hair off white; in dark mode
// it left the entire panel white with #e8ebe6 text on it.
if (isPet) document.documentElement.dataset.window = 'pet'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isPet ? <PetApp /> : <App />}</StrictMode>,
)
