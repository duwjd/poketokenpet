import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import '../tokens.css';
import '../ui.css';
import './specimen.css';
import Specimen from './Specimen.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Specimen />
  </StrictMode>,
);
