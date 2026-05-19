import { BrowserRouter, Route, Routes } from "react-router-dom";
import LandingPage from "@/pages/LandingPage";
import Workspace from "@/pages/Workspace";

/**
 * Top-level router. Two routes only — marketing landing page at `/` and
 * the actual tool at `/app`. The Workspace component owns the full
 * viewport (100vw / 100vh) and contains all the original React Flow +
 * agent / MCP plumbing, untouched.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<Workspace />} />
      </Routes>
    </BrowserRouter>
  );
}
