import { Navigate, Route, Routes } from "react-router-dom";
import { isAuthenticated } from "./auth";
import Login from "./pages/Login.jsx";
import Callback from "./pages/Callback.jsx";
import Chat from "./pages/Chat.jsx";

export default function App() {
  const authed = isAuthenticated();

  return (
    <Routes>
      <Route path="/callback" element={<Callback />} />
      <Route
        path="/"
        element={authed ? <Chat /> : <Login />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
