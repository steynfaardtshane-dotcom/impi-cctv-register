import React, { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#101A29", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <form onSubmit={handleSubmit} style={{ background: "#fff", borderRadius: 14, padding: 28, width: "100%", maxWidth: 360, boxShadow: "0 20px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "#FDDB07", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Camera size={20} color="#101A29" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#101A29" }}>IMPI CCTV Register</div>
            <div style={{ fontSize: 11.5, color: "#8A8F98" }}>Amandla Protection Services</div>
          </div>
        </div>

        <label style={labelStyle}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required style={inputStyle} placeholder="you@impi-secure.co.za" />

        <label style={labelStyle}>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required style={inputStyle} placeholder="••••••••" />

        {error && <div style={{ color: "#DE1819", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}

        <button type="submit" disabled={busy} style={{ width: "100%", background: "#101A29", color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 }}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : "Log in"}
        </button>

        <div style={{ fontSize: 11, color: "#9AA1AC", marginTop: 14, lineHeight: 1.5 }}>
          Admin and technician accounts are created by Shane in the Supabase project. Contact your administrator if you need access.
        </div>
      </form>
    </div>
  );
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, color: "#8A8F98", display: "block", marginBottom: 4, marginTop: 10 };
const inputStyle = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 8, padding: "9px 11px", fontSize: 14, outline: "none", boxSizing: "border-box" };
