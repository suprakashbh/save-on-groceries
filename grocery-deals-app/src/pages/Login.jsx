import { login } from "../auth";

export default function Login() {
  return (
    <div className="page">
      <div className="hero">
        <div className="hero-badge">Secure sign in</div>
        <h1>Grocery Deals, curated fast.</h1>
        <p>
          Search weekly deals across providers. Sign in to start a focused chat
          with the deals agent.
        </p>
        <button className="primary" onClick={login}>
          Sign in with Cognito
        </button>
        <div className="hero-note">
          No registration here. Use your existing account.
        </div>
      </div>
      <div className="panel">
        <div className="panel-card">
          <h2>What you can ask</h2>
          <ul>
            <li>“Show me the deals on tea”</li>
            <li>“Find gluten-free wraps under $5”</li>
            <li>“Cheapest oats this week”</li>
          </ul>
        </div>
        <div className="panel-card accent">
          <h2>Trusted sources</h2>
          <p>
            Results are pulled from the weekly-grocery-deals collection and
            sorted by the lowest price first.
          </p>
        </div>
      </div>
    </div>
  );
}
