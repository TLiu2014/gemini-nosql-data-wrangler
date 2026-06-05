import { BrowserRouter, Route, Routes } from "react-router-dom";
import DocsPage from "@/pages/DocsPage";
import LandingPage from "@/pages/LandingPage";
import Workspace from "@/pages/Workspace";

/**
 * Top-level router. Three routes — marketing landing page at `/`, the
 * public tool / agent reference at `/docs`, and the actual tool at `/app`.
 * The Workspace component owns the full viewport (100vw / 100vh) and
 * contains all the React Flow + agent / MCP plumbing.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/app" element={<Workspace />} />
      </Routes>
    </BrowserRouter>
  );
}
