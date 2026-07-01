import React, { useState, useEffect, useRef } from "react";
import {
  Plus, Trash2, Printer, Upload, MapPin, Building2, Check,
  Crosshair, Loader2, Menu, LogOut, WifiOff, Cloud, CloudOff, RefreshCw
} from "lucide-react";
import { supabase, isAdminUser } from "./lib/supabase";
import impiMark from "./assets/impi-mark.png";
import {
  fetchAllSites, saveSiteLocalAndQueue, deleteSiteLocalAndQueue,
  saveCameraLocalAndQueue, deleteCameraLocalAndQueue,
  savePinLocalAndQueue, deletePinLocalAndQueue,
  uploadFloorplan, onSyncStateChange, flushQueue, pendingCount, uid,
} from "./lib/db";
import Login from "./components/Login";

const STATUS_OPTIONS = [
  { value: "online", label: "Online", dot: "#1FAE5C", bg: "#E8F7EE", text: "#1A7A43" },
  { value: "offline", label: "Offline", dot: "#8A8F98", bg: "#F1F2F4", text: "#5B616B" },
  { value: "fault", label: "Faulty", dot: "#DE1819", bg: "#FDEBEB", text: "#B91414" },
  { value: "planned", label: "Planned", dot: "#FDDB07", bg: "#FFFBE6", text: "#8A7300" },
];
const POWER_OPTIONS = ["PoE", "PoE+", "24V AC", "12V DC", "Solar", "Mains", "Other"];
const COMPANY = {
  name: "IMPI Protection Agency",
  legal: "IMPI RMS (Pty) Ltd t/a Amandla Protection Services",
  address: "10 Kosmos Crescent, Rynoue AH, Roodeplaat, Pretoria",
  phone: "012 543 0640",
  email: "info@impi-secure.co.za",
  web: "www.impi-secure.co.za",
};
const statusMeta = (v) => STATUS_OPTIONS.find((s) => s.value === v) || STATUS_OPTIONS[0];

function resizeImageFile(file, maxW = 1700) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("load failed"));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => resolve({ blob, w, h }), "image/jpeg", 0.82);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [syncState, setSyncState] = useState(navigator.onLine ? "synced" : "offline");
  const [pending, setPending] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const off = onSyncStateChange((s) => {
      setSyncState(s);
      setPending(pendingCount());
    });
    function goOnline() { setSyncState("syncing"); flushQueue(); }
    function goOffline() { setSyncState("offline"); }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { off(); window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

  if (session === undefined) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#101A29" }}><Loader2 className="animate-spin" color="#fff" /></div>;
  }
  if (!session) return <Login />;

  return <Dashboard user={session.user} syncState={syncState} pending={pending} />;
}

function Dashboard({ user, syncState, pending }) {
  const isAdmin = isAdminUser(user);
  const [allSites, setAllSites] = useState([]);
  const [camerasBySite, setCamerasBySite] = useState({});
  const [pinsByCamera, setPinsByCamera] = useState({});
  const [activeSiteId, setActiveSiteId] = useState(localStorage.getItem("impi_last_site") || null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("diagram");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [placingForId, setPlacingForId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [showNewSite, setShowNewSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);

  const diagramRef = useRef(null);
  const fileInputRef = useRef(null);
  const debounceTimers = useRef({}); // key -> { timerId, run }

  // Safety net: if the app is closed, backgrounded, or the phone locks
  // while a debounced save is still waiting, flush every pending save
  // immediately instead of letting it be lost. Covers PWA close, tab
  // switch, phone lock, and browser/app being killed.
  useEffect(() => {
    function flushAllPending() {
      Object.values(debounceTimers.current).forEach(({ timerId, run }) => {
        clearTimeout(timerId);
        run();
      });
      debounceTimers.current = {};
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") flushAllPending();
    }
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushAllPending);
    window.addEventListener("beforeunload", flushAllPending);
    return () => {
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushAllPending);
      window.removeEventListener("beforeunload", flushAllPending);
    };
  }, []);

  // Belt-and-braces retry: some networks report "online" while requests
  // still quietly fail (patchy site wifi/data). Re-attempt the queue
  // every 20s whenever there's something waiting, not just on the
  // browser's online/offline events.
  useEffect(() => {
    const t = setInterval(() => { if (navigator.onLine) flushQueue(); }, 20000);
    return () => clearInterval(t);
  }, []);

  async function reload() {
    setLoading(true);
    const res = await fetchAllSites();
    setAllSites(res.sites || []);
    setCamerasBySite(res.camerasBySite || {});
    setPinsByCamera(res.pinsByCamera || {});
    setLoading(false);
    if (!activeSiteId && res.sites && res.sites.length > 0) {
      setActiveSiteId(res.sites[0].id);
    }
  }

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeSiteId) localStorage.setItem("impi_last_site", activeSiteId);
  }, [activeSiteId]);

  const activeSite = allSites.find((s) => s.id === activeSiteId) || null;
  const cameras = activeSiteId ? camerasBySite[activeSiteId] || [] : [];
  const pinned = new Set(cameras.filter((c) => pinsByCamera[c.id]).map((c) => c.id));

  function debouncedSave(key, fn, delay = 600) {
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key].timerId);
    const timerId = setTimeout(() => {
      fn();
      delete debounceTimers.current[key];
    }, delay);
    debounceTimers.current[key] = { timerId, run: fn };
  }

  function updateSiteField(field, value) {
    updateSiteFields({ [field]: value });
  }

  // Updates several fields on the active site in a single, atomic write.
  // (Calling updateSiteField three times in a row for url/w/h caused each
  // call to overwrite the previous one before it landed, silently dropping
  // the floor plan URL — this fixes that.)
  function updateSiteFields(fields) {
    if (!activeSite) return;
    const updated = { ...activeSite, ...fields, updated_at: new Date().toISOString() };
    setAllSites((list) => list.map((s) => (s.id === activeSite.id ? updated : s)));
    debouncedSave("site:" + activeSite.id, () => saveSiteLocalAndQueue(updated));
  }

  async function createSite() {
    const name = newSiteName.trim() || "New Site";
    const row = {
      id: uid(),
      name,
      client: "",
      address: "",
      survey_date: new Date().toISOString().slice(0, 10),
      surveyor: user.email,
      notes: "",
      floorplan_url: null,
      floorplan_w: null,
      floorplan_h: null,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    setAllSites((list) => [row, ...list]);
    saveSiteLocalAndQueue(row);
    setNewSiteName("");
    setShowNewSite(false);
    setActiveSiteId(row.id);
    setTab("diagram");
    setSidebarOpen(false);
  }

  function removeSite(id) {
    if (!window.confirm("Delete this site and all its devices? This cannot be undone.")) return;
    setAllSites((list) => list.filter((s) => s.id !== id));
    deleteSiteLocalAndQueue(id);
    if (activeSiteId === id) {
      const remaining = allSites.filter((s) => s.id !== id);
      setActiveSiteId(remaining[0]?.id || null);
    }
  }

  function updateCamera(id, field, value) {
    const list = camerasBySite[activeSiteId] || [];
    const updated = list.map((c) => (c.id === id ? { ...c, [field]: value } : c));
    setCamerasBySite((m) => ({ ...m, [activeSiteId]: updated }));
    const row = updated.find((c) => c.id === id);
    debouncedSave("cam:" + id, () => saveCameraLocalAndQueue(activeSiteId, row));
  }

  function addDeviceRow() {
    const n = cameras.length + 1;
    const cam = {
      id: uid(),
      site_id: activeSiteId,
      label: `CAM-${String(n).padStart(2, "0")}`,
      location: "",
      ip: "",
      mac: "",
      model: "",
      channel: "",
      power: "PoE",
      status: "planned",
      notes: "",
    };
    setCamerasBySite((m) => ({ ...m, [activeSiteId]: [...(m[activeSiteId] || []), cam] }));
    saveCameraLocalAndQueue(activeSiteId, cam);
    return cam.id;
  }

  function removeDevice(id) {
    if (!window.confirm("Remove this device and its diagram pin?")) return;
    setCamerasBySite((m) => ({ ...m, [activeSiteId]: (m[activeSiteId] || []).filter((c) => c.id !== id) }));
    setPinsByCamera((m) => { const n = { ...m }; delete n[id]; return n; });
    deleteCameraLocalAndQueue(activeSiteId, id);
    if (placingForId === id) setPlacingForId(null);
  }

  async function handleFloorplanFile(file) {
    if (!file || !activeSite) return;
    if (!navigator.onLine) {
      window.alert("You're offline — connect to the internet to upload a floor plan photo, then try again.");
      return;
    }
    setUploadBusy(true);
    try {
      const { blob, w, h } = await resizeImageFile(file);
      const url = await uploadFloorplan(activeSite.id, blob, "jpg");
      updateSiteFields({ floorplan_url: url, floorplan_w: w, floorplan_h: h });
    } catch (e) {
      console.error("Floor plan upload failed:", e);
      window.alert("Could not upload that image. Check your connection and try again.");
    } finally {
      setUploadBusy(false);
    }
  }

  function diagramPoint(e) {
    const rect = diagramRef.current.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    let x = ((cx - rect.left) / rect.width) * 100;
    let y = ((cy - rect.top) / rect.height) * 100;
    return { x: Math.max(1, Math.min(99, x)), y: Math.max(1, Math.min(99, y)) };
  }

  function handleDiagramClick(e) {
    if (!activeSite?.floorplan_url || !placingForId) return;
    if (e.target.closest("[data-pin]")) return;
    const { x, y } = diagramPoint(e);
    const pin = { camera_id: placingForId, x, y, site_id: activeSiteId };
    setPinsByCamera((m) => ({ ...m, [placingForId]: pin }));
    savePinLocalAndQueue(pin);
    setHighlightId(placingForId);
    setPlacingForId(null);
    setTimeout(() => setHighlightId(null), 1600);
  }

  useEffect(() => {
    if (!draggingId) return;
    function onMove(e) {
      if (!diagramRef.current) return;
      const { x, y } = diagramPoint(e);
      setPinsByCamera((m) => ({ ...m, [draggingId]: { ...m[draggingId], x, y } }));
    }
    function onUp() {
      setPinsByCamera((m) => {
        if (m[draggingId]) savePinLocalAndQueue(m[draggingId]);
        return m;
      });
      setDraggingId(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [draggingId]); // eslint-disable-line react-hooks/exhaustive-deps

  function locateDevice(id) {
    setTab("diagram");
    if (pinsByCamera[id]) {
      setHighlightId(id);
      setTimeout(() => setHighlightId(null), 1600);
    } else {
      setPlacingForId(id);
    }
  }

  function startNewDeviceThenPlace() {
    const id = addDeviceRow();
    setPlacingForId(id);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F4F5F7", fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`
        .print-only { display: none; }
        @media print {
          .screen-only { display: none !important; }
          .print-only { display: block !important; }
          @page { margin: 14mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        @media (min-width: 900px) {
          .sidebar-fixed { left: 0 !important; }
          .main-area { margin-left: 280px !important; }
        }
        @media (max-width: 640px) { .hide-sm { display: none; } }
        .ipsheet-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .ipsheet-scroll::-webkit-scrollbar-thumb { background: #D8DBE0; border-radius: 8px; }
      `}</style>

      <div className="screen-only">
        <div style={{ display: "flex", minHeight: "100vh" }}>
          {/* Sidebar */}
          <div className="sidebar-fixed" style={{ width: 280, flexShrink: 0, background: "#101A29", color: "#fff", position: "fixed", top: 0, bottom: 0, left: sidebarOpen ? 0 : -300, transition: "left .2s ease", zIndex: 40, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "18px 16px", borderBottom: "1px solid #1F2C40" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <img src={impiMark} alt="IMPI" style={{ width: 34, height: 34, objectFit: "contain" }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>IMPI CCTV Register</div>
                  <div style={{ fontSize: 11, color: "#8B95A7", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.email} {isAdmin && "· admin"}</div>
                </div>
              </div>
            </div>

            <div style={{ padding: 12, flex: 1, overflowY: "auto" }} className="ipsheet-scroll">
              {showNewSite ? (
                <div style={{ background: "#16223A", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                  <input autoFocus value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createSite()} placeholder="Site name e.g. Nasonti HQ" style={{ width: "100%", background: "#0F1722", border: "1px solid #2A3954", borderRadius: 6, padding: "7px 9px", color: "#fff", fontSize: 13, outline: "none" }} />
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button onClick={createSite} style={btnPrimarySm}>Create</button>
                    <button onClick={() => { setShowNewSite(false); setNewSiteName(""); }} style={btnGhostSm}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowNewSite(true)} style={{ ...btnPrimarySm, width: "100%", justifyContent: "center", marginBottom: 10 }}><Plus size={15} /> New site</button>
              )}

              {loading && <div style={{ fontSize: 12, color: "#7C879C", padding: 8 }}>Loading sites…</div>}
              {!loading && allSites.length === 0 && <div style={{ fontSize: 12.5, color: "#7C879C", padding: "10px 4px" }}>No sites yet. Create your first site.</div>}

              {allSites.map((s) => (
                <div key={s.id} onClick={() => { setActiveSiteId(s.id); setSidebarOpen(false); setTab("diagram"); }} style={{ padding: 10, borderRadius: 8, marginBottom: 4, cursor: "pointer", background: s.id === activeSiteId ? "#1B2A45" : "transparent", border: s.id === activeSiteId ? "1px solid #FDDB07" : "1px solid transparent", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name || "Untitled site"}</div>
                    <div style={{ fontSize: 11, color: "#7C879C", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.client || "No client set"}</div>
                  </div>
                  {isAdmin && (
                    <button onClick={(e) => { e.stopPropagation(); removeSite(s.id); }} style={{ background: "none", border: "none", color: "#5B6577", cursor: "pointer", padding: 4, flexShrink: 0 }} title="Delete site">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div style={{ padding: "12px 16px", borderTop: "1px solid #1F2C40" }}>
              <SyncBadge state={syncState} pending={pending} />
              <button onClick={handleLogout} style={{ marginTop: 10, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "none", border: "1px solid #2A3954", color: "#9AA1AC", borderRadius: 8, padding: "8px 0", fontSize: 12.5, cursor: "pointer" }}>
                <LogOut size={13} /> Log out
              </button>
            </div>
          </div>

          {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 30 }} />}

          {/* Main */}
          <div className="main-area" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ position: "sticky", top: 0, zIndex: 20, background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => setSidebarOpen(true)} style={{ background: "#101A29", color: "#fff", border: "none", borderRadius: 8, padding: 8, cursor: "pointer", display: "flex" }}><Menu size={16} /></button>
              <div style={{ minWidth: 0, flex: 1 }}>
                {activeSite ? (
                  <input value={activeSite.name || ""} onChange={(e) => updateSiteField("name", e.target.value)} placeholder="Site name" style={{ fontSize: 17, fontWeight: 700, border: "none", outline: "none", width: "100%", color: "#101A29" }} />
                ) : (
                  <div style={{ fontSize: 17, fontWeight: 700, color: "#101A29" }}>No site selected</div>
                )}
              </div>
              {activeSite && <button onClick={() => window.print()} style={btnDark}><Printer size={15} /> <span className="hide-sm">Print / PDF</span></button>}
            </div>

            {!activeSite ? (
              <div style={{ padding: 60, textAlign: "center", color: "#6B7280" }}>
                <Building2 size={36} style={{ margin: "0 auto 10px", opacity: 0.5 }} />
                {loading ? "Loading…" : "Create or select a site from the menu to begin."}
              </div>
            ) : (
              <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
                <div style={cardStyle}>
                  <div style={cardTitle}>Site information</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                    <Field label="Client / site contact" value={activeSite.client || ""} onChange={(v) => updateSiteField("client", v)} />
                    <Field label="Site address" value={activeSite.address || ""} onChange={(v) => updateSiteField("address", v)} />
                    <Field label="Survey / update date" type="date" value={activeSite.survey_date || ""} onChange={(v) => updateSiteField("survey_date", v)} />
                    <Field label="Surveyed by" value={activeSite.surveyor || ""} onChange={(v) => updateSiteField("surveyor", v)} />
                  </div>
                  <div style={{ marginTop: 10 }}><Field label="General notes" value={activeSite.notes || ""} onChange={(v) => updateSiteField("notes", v)} textarea /></div>
                </div>

                <div style={{ display: "flex", gap: 6, margin: "16px 0 10px" }}>
                  <TabBtn active={tab === "diagram"} onClick={() => setTab("diagram")}>Diagram</TabBtn>
                  <TabBtn active={tab === "devices"} onClick={() => setTab("devices")}>Devices ({cameras.length})</TabBtn>
                </div>

                {tab === "diagram" && (
                  <div style={cardStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      <div style={cardTitle}>Site diagram</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={() => fileInputRef.current.click()} style={btnGhost}><Upload size={14} /> {activeSite.floorplan_url ? "Replace floor plan" : "Upload floor plan"}</button>
                        {activeSite.floorplan_url && (
                          <button onClick={startNewDeviceThenPlace} style={placingForId ? btnAmber : btnPrimary}><Crosshair size={14} /> {placingForId ? "Click on plan to place…" : "Add device on diagram"}</button>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleFloorplanFile(e.target.files[0])}
                        style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}
                      />
                    </div>

                    {uploadBusy && <div style={{ fontSize: 12.5, color: "#6B7280", marginBottom: 8 }}>Uploading image…</div>}

                    {!activeSite.floorplan_url ? (
                      <div onClick={() => fileInputRef.current.click()} style={{ border: "2px dashed #D8DBE0", borderRadius: 10, padding: 50, textAlign: "center", color: "#8A8F98", cursor: "pointer" }}>
                        <Upload size={26} style={{ margin: "0 auto 8px" }} />
                        Upload a site floor plan or photo (JPG / PNG) to start placing camera pins.
                      </div>
                    ) : (
                      <>
                        {placingForId && (
                          <div style={{ background: "#FFFBE6", border: "1px solid #FDDB07", color: "#8A7300", fontSize: 12.5, padding: "7px 10px", borderRadius: 8, marginBottom: 8 }}>
                            Click anywhere on the plan to drop a pin for <strong>{cameras.find((c) => c.id === placingForId)?.label}</strong>.{" "}
                            <button onClick={() => setPlacingForId(null)} style={{ background: "none", border: "none", color: "#8A7300", textDecoration: "underline", cursor: "pointer", padding: 0 }}>Cancel</button>
                          </div>
                        )}
                        <div ref={diagramRef} onClick={handleDiagramClick} style={{ position: "relative", width: "100%", borderRadius: 10, overflow: "hidden", border: "1px solid #E5E7EB", cursor: placingForId ? "crosshair" : "default", userSelect: "none", touchAction: "none" }}>
                          <img src={activeSite.floorplan_url} alt="Site floor plan" style={{ width: "100%", display: "block", pointerEvents: "none" }} draggable={false} />
                          {cameras.map((cam) => {
                            const p = pinsByCamera[cam.id];
                            if (!p) return null;
                            const m = statusMeta(cam.status);
                            const big = highlightId === cam.id;
                            return (
                              <div key={cam.id} data-pin onPointerDown={(e) => { e.stopPropagation(); setDraggingId(cam.id); }} onClick={(e) => { e.stopPropagation(); setHighlightId(cam.id); setTimeout(() => setHighlightId(null), 1600); }} style={{ position: "absolute", left: `${p.x}%`, top: `${p.y}%`, transform: `translate(-50%,-100%) scale(${big ? 1.25 : 1})`, transition: "transform .15s", cursor: "grab", zIndex: big ? 10 : 1, display: "flex", flexDirection: "column", alignItems: "center" }} title={`${cam.label} — ${cam.ip || "no IP set"}`}>
                                <div style={{ background: "#101A29", color: "#fff", fontSize: 10.5, fontWeight: 700, padding: "2px 6px", borderRadius: 5, marginBottom: 2, whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }}>{cam.label}</div>
                                <MapPin size={28} color={m.dot} fill={m.dot} fillOpacity={0.25} strokeWidth={2.2} />
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11.5, color: "#6B7280" }}>
                          {STATUS_OPTIONS.map((s) => (<div key={s.value} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 9, background: s.dot, display: "inline-block" }} /> {s.label}</div>))}
                          <div style={{ color: "#9AA1AC" }}>Drag a pin to reposition it.</div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {tab === "devices" && (
                  <div style={cardStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <div style={cardTitle}>Devices / IP register</div>
                      <button onClick={() => addDeviceRow()} style={btnPrimary}><Plus size={14} /> Add device</button>
                    </div>
                    {cameras.length === 0 ? (
                      <div style={{ color: "#8A8F98", fontSize: 13, padding: "20px 4px" }}>No devices yet. Add one here, or click "Add device on diagram" on the Diagram tab.</div>
                    ) : (
                      <div style={{ overflowX: "auto" }} className="ipsheet-scroll">
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
                          <thead>
                            <tr style={{ textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#8A8F98" }}>
                              {["Label", "Location / zone", "IP address", "MAC address", "Make & model", "NVR ch.", "Power", "Status", "Notes", ""].map((h) => (<th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap" }}>{h}</th>))}
                            </tr>
                          </thead>
                          <tbody>
                            {cameras.map((c) => (
                              <tr key={c.id} style={{ background: highlightId === c.id ? "#FFFBE6" : "transparent" }}>
                                <Td><Cell value={c.label} onChange={(v) => updateCamera(c.id, "label", v)} w={90} bold /></Td>
                                <Td><Cell value={c.location} onChange={(v) => updateCamera(c.id, "location", v)} w={130} placeholder="e.g. Front gate" /></Td>
                                <Td><Cell value={c.ip} onChange={(v) => updateCamera(c.id, "ip", v)} w={120} placeholder="192.168.1.x" mono /></Td>
                                <Td><Cell value={c.mac} onChange={(v) => updateCamera(c.id, "mac", v)} w={130} placeholder="AA:BB:CC:..." mono /></Td>
                                <Td><Cell value={c.model} onChange={(v) => updateCamera(c.id, "model", v)} w={140} placeholder="Make & model" /></Td>
                                <Td><Cell value={c.channel} onChange={(v) => updateCamera(c.id, "channel", v)} w={55} placeholder="#" /></Td>
                                <Td><select value={c.power} onChange={(e) => updateCamera(c.id, "power", e.target.value)} style={selectStyle}>{POWER_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}</select></Td>
                                <Td><select value={c.status} onChange={(e) => updateCamera(c.id, "status", e.target.value)} style={{ ...selectStyle, color: statusMeta(c.status).text, background: statusMeta(c.status).bg, fontWeight: 600 }}>{STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Td>
                                <Td><Cell value={c.notes} onChange={(v) => updateCamera(c.id, "notes", v)} w={150} placeholder="Notes" /></Td>
                                <Td>
                                  <div style={{ display: "flex", gap: 4 }}>
                                    <button onClick={() => locateDevice(c.id)} title={pinned.has(c.id) ? "Locate on diagram" : "Place on diagram"} style={iconBtn}><MapPin size={14} color={pinned.has(c.id) ? "#101A29" : "#FDDB07"} fill={pinned.has(c.id) ? "none" : "#FDDB07"} /></button>
                                    <button onClick={() => removeDevice(c.id)} title="Remove device" style={iconBtn}><Trash2 size={14} color="#DE1819" /></button>
                                  </div>
                                </Td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
                <div style={{ height: 30 }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {activeSite && (
        <div className="print-only">
          <PrintReport site={activeSite} cameras={cameras} pinsByCamera={pinsByCamera} />
        </div>
      )}
    </div>
  );
}

function PrintReport({ site, cameras, pinsByCamera }) {
  return (
    <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "#1A1A1A" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "3px solid #DE1819", paddingBottom: 10, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <img src={impiMark} alt="IMPI" style={{ width: 54, height: 54, objectFit: "contain", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "Arial, sans-serif" }}>{COMPANY.name}</div>
            <div style={{ fontSize: 11, color: "#444" }}>{COMPANY.legal}</div>
            <div style={{ fontSize: 11, color: "#444" }}>{COMPANY.address}</div>
            <div style={{ fontSize: 11, color: "#444" }}>{COMPANY.phone} &nbsp;|&nbsp; {COMPANY.email} &nbsp;|&nbsp; {COMPANY.web}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "Arial, sans-serif", background: "#101A29", color: "#fff", padding: "5px 10px", borderRadius: 4 }}>CCTV IP &amp; DIAGRAM SHEET</div>
        </div>
      </div>

      <table style={{ width: "100%", fontSize: 12, marginBottom: 16, fontFamily: "Arial, sans-serif", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ padding: "3px 0", width: 130, color: "#555" }}>Site</td>
            <td style={{ padding: "3px 0", fontWeight: 700 }}>{site.name || "—"}</td>
            <td style={{ padding: "3px 0", width: 130, color: "#555" }}>Survey / update date</td>
            <td style={{ padding: "3px 0", fontWeight: 700 }}>{site.survey_date || "—"}</td>
          </tr>
          <tr>
            <td style={{ padding: "3px 0", color: "#555" }}>Client / contact</td>
            <td style={{ padding: "3px 0" }}>{site.client || "—"}</td>
            <td style={{ padding: "3px 0", color: "#555" }}>Surveyed by</td>
            <td style={{ padding: "3px 0" }}>{site.surveyor || "—"}</td>
          </tr>
          <tr>
            <td style={{ padding: "3px 0", color: "#555" }}>Site address</td>
            <td style={{ padding: "3px 0" }} colSpan={3}>{site.address || "—"}</td>
          </tr>
          {site.notes && (<tr><td style={{ padding: "3px 0", color: "#555", verticalAlign: "top" }}>Notes</td><td style={{ padding: "3px 0" }} colSpan={3}>{site.notes}</td></tr>)}
        </tbody>
      </table>

      {site.floorplan_url && (
        <div style={{ marginBottom: 18, breakInside: "avoid" }}>
          <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "Arial, sans-serif", marginBottom: 6 }}>SITE DIAGRAM</div>
          <div style={{ position: "relative", width: "100%", border: "1px solid #ccc" }}>
            <img src={site.floorplan_url} alt="Floor plan" style={{ width: "100%", display: "block" }} />
            {cameras.map((cam) => {
              const p = pinsByCamera[cam.id];
              if (!p) return null;
              const m = statusMeta(cam.status);
              return (
                <div key={cam.id} style={{ position: "absolute", left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%,-100%)", textAlign: "center" }}>
                  <div style={{ background: "#101A29", color: "#fff", fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 3, marginBottom: 1, fontFamily: "Arial, sans-serif", whiteSpace: "nowrap" }}>{cam.label}</div>
                  <MapPin size={18} color={m.dot} fill={m.dot} fillOpacity={0.3} strokeWidth={2.4} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "Arial, sans-serif", marginBottom: 6 }}>DEVICE / IP REGISTER</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, fontFamily: "Arial, sans-serif" }}>
        <thead>
          <tr style={{ background: "#101A29", color: "#fff" }}>
            {["#", "Label", "Location", "IP address", "MAC address", "Make & model", "Ch.", "Power", "Status", "Notes"].map((h) => (<th key={h} style={{ padding: "5px 6px", textAlign: "left", border: "1px solid #101A29" }}>{h}</th>))}
          </tr>
        </thead>
        <tbody>
          {cameras.map((c, i) => (
            <tr key={c.id} style={{ breakInside: "avoid" }}>
              <td style={tdP}>{i + 1}</td>
              <td style={{ ...tdP, fontWeight: 700 }}>{c.label}</td>
              <td style={tdP}>{c.location || "—"}</td>
              <td style={tdP}>{c.ip || "—"}</td>
              <td style={tdP}>{c.mac || "—"}</td>
              <td style={tdP}>{c.model || "—"}</td>
              <td style={tdP}>{c.channel || "—"}</td>
              <td style={tdP}>{c.power}</td>
              <td style={tdP}>{statusMeta(c.status).label}</td>
              <td style={tdP}>{c.notes || ""}</td>
            </tr>
          ))}
          {cameras.length === 0 && (<tr><td colSpan={10} style={{ ...tdP, textAlign: "center", color: "#888" }}>No devices recorded.</td></tr>)}
        </tbody>
      </table>

      <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", fontSize: 10, color: "#777", borderTop: "1px solid #ddd", paddingTop: 8, fontFamily: "Arial, sans-serif" }}>
        <span>Generated {new Date().toLocaleDateString("en-ZA")} — {COMPANY.name}</span>
        <span>Page produced for internal / client reference</span>
      </div>
    </div>
  );
}

function SyncBadge({ state, pending }) {
  const map = {
    synced: { icon: <Cloud size={13} />, text: "All changes saved", color: "#5FE3A0" },
    syncing: { icon: <RefreshCw size={13} className="animate-spin" />, text: "Syncing…", color: "#FDDB07" },
    offline: { icon: <WifiOff size={13} />, text: pending ? `Offline — ${pending} change(s) pending` : "Offline — changes saved on device", color: "#FDDB07" },
    error: { icon: <CloudOff size={13} />, text: `${pending} change(s) waiting to sync`, color: "#FF8A8A" },
  };
  const m = map[state] || map.synced;
  return <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: m.color }}>{m.icon} {m.text}</div>;
}

const cardStyle = { background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16, marginBottom: 6 };
const cardTitle = { fontSize: 13, fontWeight: 700, color: "#101A29", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 };
const tdP = { padding: "4px 6px", border: "1px solid #ccc" };
const selectStyle = { fontSize: 12.5, border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 6px", outline: "none", width: "100%" };
const iconBtn = { background: "#F4F5F7", border: "1px solid #E5E7EB", borderRadius: 6, padding: 6, cursor: "pointer", display: "flex" };
const btnPrimary = { display: "inline-flex", alignItems: "center", gap: 6, background: "#101A29", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const btnAmber = { ...btnPrimary, background: "#FDDB07", color: "#101A29" };
const btnGhost = { display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "#101A29", border: "1px solid #D8DBE0", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const btnDark = { display: "inline-flex", alignItems: "center", gap: 6, background: "#DE1819", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const btnPrimarySm = { display: "inline-flex", alignItems: "center", gap: 5, background: "#FDDB07", color: "#101A29", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
const btnGhostSm = { background: "none", color: "#9AA1AC", border: "1px solid #2A3954", borderRadius: 6, padding: "6px 10px", fontSize: 12.5, cursor: "pointer" };

function Field({ label, value, onChange, type = "text", textarea, placeholder }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#8A8F98", marginBottom: 3, fontWeight: 600 }}>{label}</div>
      {textarea ? (
        <textarea value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} rows={2} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 7, padding: "7px 9px", fontSize: 13.5, outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
      ) : (
        <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 7, padding: "7px 9px", fontSize: 13.5, outline: "none", boxSizing: "border-box" }} />
      )}
    </div>
  );
}

function Cell({ value, onChange, w = 100, placeholder, mono, bold }) {
  return (
    <input value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ width: w, border: "1px solid transparent", background: "transparent", padding: "5px 6px", fontSize: 12.5, outline: "none", borderRadius: 5, fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit", fontWeight: bold ? 700 : 400 }} onFocus={(e) => (e.target.style.border = "1px solid #FDDB07")} onBlur={(e) => (e.target.style.border = "1px solid transparent")} />
  );
}

function Td({ children }) { return <td style={{ padding: "2px 4px", borderBottom: "1px solid #F1F2F4", verticalAlign: "middle" }}>{children}</td>; }

function TabBtn({ active, children, onClick }) {
  return <button onClick={onClick} style={{ padding: "8px 16px", borderRadius: 8, border: active ? "1px solid #101A29" : "1px solid #E5E7EB", background: active ? "#101A29" : "#fff", color: active ? "#fff" : "#101A29", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{children}</button>;
}
