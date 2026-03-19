import { useEffect, useState } from "react";
import { handleCallback } from "../auth";

export default function Callback() {
  const [error, setError] = useState("");

  useEffect(() => {
    async function run() {
      try {
        await handleCallback(window.location.search);
        window.location.replace("/");
      } catch (err) {
        setError(err.message || String(err));
      }
    }
    run();
  }, []);

  return (
    <div className="page centered">
      <div className="panel-card">
        <h2>Signing you in…</h2>
        {error ? <p className="error">{error}</p> : <p>Finalizing login.</p>}
      </div>
    </div>
  );
}
