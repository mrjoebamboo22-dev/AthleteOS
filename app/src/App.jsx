import { useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import "./App.css";

const choices = [
  ["profile", "Athlete profile", "Name, age group, team, and sport", true],
  ["performance_metrics", "Performance metrics", "Testing results, goals, and progress", true],
  ["coach_assignments", "Coach assignments", "Assigned workouts and coach feedback", true],
  ["verification_media", "Verification media", "Optional photos or videos used to verify results", false],
];

export default function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [screen, setScreen] = useState("review");
  const [scope, setScope] = useState(Object.fromEntries(choices.map(([key,,, enabled]) => [key, enabled])));
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [screen, session]);

  async function execute(action) {
    setBusy(true);
    setError("");
    try { await action(); }
    catch (e) {
      const message = e?.message || "Something went wrong.";
      setError(message);
      setAnnouncement(`Error: ${message}`);
    } finally { setBusy(false); }
  }

  async function signIn(event) {
    event.preventDefault();
    await execute(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setAnnouncement("Signed in successfully.");
    });
  }

  async function grantConsent() {
    await execute(async () => {
      if (!athleteId.trim()) throw new Error("Enter the athlete ID.");
      const { error } = await supabase.rpc("grant_guardian_consent", {
        target_athlete_id: athleteId.trim(),
        consent_scope: scope,
        privacy_notice_version: "1.0",
        terms_version: "1.0",
      });
      if (error) throw error;
      setScreen("success");
      setAnnouncement("Guardian consent recorded successfully.");
    });
  }

  async function submitPrivacyAction(deleting) {
    await execute(async () => {
      const { error } = await supabase.rpc(
        deleting ? "request_athlete_deletion" : "revoke_guardian_consent",
        { target_athlete_id: athleteId.trim(), reason: reason.trim() || null }
      );
      if (error) throw error;
      setScreen(deleting ? "deletionSubmitted" : "revoked");
      setAnnouncement(deleting ? "Deletion request submitted." : "Guardian consent revoked.");
      setConfirmed(false);
      setReason("");
    });
  }

  if (!session) return (
    <Shell announcement={announcement} error={error}>
      <section className="card">
        <p className="eyebrow">ATHLETE OS</p>
        <h1 ref={headingRef} tabIndex="-1">Guardian sign in</h1>
        <p className="muted">Sign in with the verified guardian account.</p>
        <form onSubmit={signIn} className="stack">
          <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required /></label>
          <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </Shell>
  );

  if (["revoke", "delete"].includes(screen)) {
    const deleting = screen === "delete";
    return (
      <Shell announcement={announcement} error={error}>
        <button className="back" onClick={() => setScreen("manage")}>← Back</button>
        <section className="card">
          <p className="eyebrow">GUARDIAN CONTROLS</p>
          <h1 ref={headingRef} tabIndex="-1">{deleting ? "Request permanent deletion?" : "Revoke consent?"}</h1>
          <p className="muted">{deleting ? "This begins a verified deletion workflow and restricts athlete access while processing." : "New collection, assignments, and uploads will stop immediately."}</p>
          <label>Optional reason<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength="500" /></label>
          <label className="confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I understand and confirm that I am the verified guardian.</label>
          <button className={deleting ? "danger" : "warning"} disabled={!confirmed || busy} onClick={() => submitPrivacyAction(deleting)}>{busy ? "Submitting…" : deleting ? "Submit deletion request" : "Revoke consent now"}</button>
        </section>
      </Shell>
    );
  }

  if (["success", "revoked", "deletionSubmitted"].includes(screen)) {
    const message = screen === "success" ? "Consent recorded" : screen === "revoked" ? "Consent revoked" : "Deletion request submitted";
    return (
      <Shell announcement={announcement} error={error}>
        <section className="card center">
          <div className="successIcon" aria-hidden="true">✓</div>
          <h1 ref={headingRef} tabIndex="-1">{message}</h1>
          <p className="muted">The guardian privacy status has been updated.</p>
          <button onClick={() => setScreen("manage")}>Manage consent</button>
        </section>
      </Shell>
    );
  }

  if (screen === "manage") return (
    <Shell announcement={announcement} error={error}>
      <section className="card">
        <p className="eyebrow">GUARDIAN CONTROLS</p>
        <h1 ref={headingRef} tabIndex="-1">Privacy and consent</h1>
        <div className="status"><strong>Athlete ID</strong><span>{athleteId || "Not selected"}</span></div>
        <button className="secondary" onClick={() => setScreen("review")}>Review consent choices</button>
        <button className="warning secondary" disabled={!athleteId} onClick={() => setScreen("revoke")}>Revoke consent</button>
        <button className="danger secondary" disabled={!athleteId} onClick={() => setScreen("delete")}>Request permanent deletion</button>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </section>
    </Shell>
  );

  return (
    <Shell announcement={announcement} error={error}>
      <section className="card">
        <p className="eyebrow">ATHLETE OS</p>
        <h1 ref={headingRef} tabIndex="-1">Guardian consent</h1>
        <p className="muted">Review and approve how Athlete OS may use the athlete’s information.</p>
        <label>Athlete ID<input value={athleteId} onChange={e => setAthleteId(e.target.value)} placeholder="UUID from the athlete profile" /></label>
        <div className="choices">
          {choices.map(([key, title, description]) => (
            <button key={key} type="button" className={`choice ${scope[key] ? "selected" : ""}`} aria-pressed={scope[key]} onClick={() => {
              const enabled = !scope[key];
              setScope(current => ({ ...current, [key]: enabled }));
              setAnnouncement(`${title} ${enabled ? "selected" : "not selected"}`);
            }}>
              <span className="check" aria-hidden="true">{scope[key] ? "✓" : ""}</span>
              <span><strong>{title}</strong><small>{description}</small></span>
            </button>
          ))}
        </div>
        <div className="notice"><strong>Your choices</strong><p>Verification media is optional and off by default. Advertising and nonessential third-party disclosure are not included.</p></div>
        <label className="confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I confirm that I am the athlete’s guardian and agree to the selected uses.</label>
        <button disabled={!confirmed || !scope.profile || !athleteId || busy} onClick={grantConsent}>{busy ? "Submitting…" : "Provide guardian consent"}</button>
        <button className="link" onClick={() => setScreen("manage")}>Manage consent</button>
      </section>
    </Shell>
  );
}

function Shell({ children, announcement, error }) {
  return <main><p className="srOnly" role="status" aria-live="polite" aria-atomic="true">{announcement}</p><div className="shell">{error && <div className="error" role="alert">{error}</div>}{children}</div></main>;
}
