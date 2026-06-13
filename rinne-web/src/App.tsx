import { Navigate, Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Agents from "./pages/Agents";
import AgentDetail from "./pages/AgentDetail";
import DecisionDetail from "./pages/DecisionDetail";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      {/* The hosted guard dashboard is the product. /app lands on the overview;
          agents self-register via the curl skill, so there is no register or
          scenario-harness route. */}
      <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
      <Route path="/app/dashboard" element={<Dashboard />} />
      <Route path="/app/agents" element={<Agents />} />
      <Route path="/app/agents/:agentId" element={<AgentDetail />} />
      <Route path="/app/actions/:decisionId" element={<DecisionDetail />} />
    </Routes>
  );
}
