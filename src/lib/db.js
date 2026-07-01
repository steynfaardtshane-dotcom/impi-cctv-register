import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Offline-first data layer.
//
// Every read is served from a local cache (localStorage) immediately, then
// refreshed from Supabase in the background when a connection is available.
// Every write is applied to the local cache instantly (so the UI never waits
// on the network) and is queued for sync. The queue is flushed automatically
// whenever the browser comes back online.
// ---------------------------------------------------------------------------

const CACHE_KEY = "impi_cctv_cache_v1";
const QUEUE_KEY = "impi_cctv_queue_v1";

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || { sites: [], camerasBySite: {}, pinsByCamera: {} };
  } catch {
    return { sites: [], camerasBySite: {}, pinsByCamera: {} };
  }
}
function writeCache(cache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}
function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
  } catch {
    return [];
  }
}
function writeQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}
function enqueue(op) {
  const q = readQueue();
  q.push({ ...op, queuedAt: Date.now() });
  writeQueue(q);
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

const listeners = new Set();
export function onSyncStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(state) {
  listeners.forEach((fn) => fn(state));
}

let flushing = false;
export async function flushQueue() {
  if (flushing || !navigator.onLine) return;
  const q = readQueue();
  if (q.length === 0) return;
  flushing = true;
  notify("syncing");
  const remaining = [];
  for (const op of q) {
    try {
      await applyOp(op);
    } catch (e) {
      remaining.push(op); // keep for next attempt
    }
  }
  writeQueue(remaining);
  flushing = false;
  notify(remaining.length ? "error" : "synced");
}

async function applyOp(op) {
  switch (op.type) {
    case "upsert-site": {
      const { error } = await supabase.from("sites").upsert(op.row);
      if (error) throw error;
      return;
    }
    case "delete-site": {
      const { error } = await supabase.from("sites").delete().eq("id", op.id);
      if (error) throw error;
      return;
    }
    case "upsert-camera": {
      const { error } = await supabase.from("cameras").upsert(op.row);
      if (error) throw error;
      return;
    }
    case "delete-camera": {
      const { error } = await supabase.from("cameras").delete().eq("id", op.id);
      if (error) throw error;
      return;
    }
    case "upsert-pin": {
      const { error } = await supabase.from("pins").upsert(op.row);
      if (error) throw error;
      return;
    }
    case "delete-pin": {
      const { error } = await supabase.from("pins").delete().eq("camera_id", op.cameraId);
      if (error) throw error;
      return;
    }
    default:
      return;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", flushQueue);
}

// ---------------------------------------------------------------------------
// Public API used by the UI
// ---------------------------------------------------------------------------

export async function fetchAllSites() {
  const cache = readCache();
  if (navigator.onLine) {
    try {
      const { data: sites, error } = await supabase.from("sites").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      const { data: cameras, error: e2 } = await supabase.from("cameras").select("*");
      if (e2) throw e2;
      const { data: pins, error: e3 } = await supabase.from("pins").select("*");
      if (e3) throw e3;

      const camerasBySite = {};
      cameras.forEach((c) => {
        camerasBySite[c.site_id] = camerasBySite[c.site_id] || [];
        camerasBySite[c.site_id].push(c);
      });
      const pinsByCamera = {};
      pins.forEach((p) => {
        pinsByCamera[p.camera_id] = p;
      });

      const fresh = { sites, camerasBySite, pinsByCamera };
      writeCache(fresh);
      notify("synced");
      return fresh;
    } catch (e) {
      notify("error");
      return cache;
    }
  }
  return cache;
}

export function saveSiteLocalAndQueue(site) {
  const cache = readCache();
  const idx = cache.sites.findIndex((s) => s.id === site.id);
  if (idx >= 0) cache.sites[idx] = site;
  else cache.sites.unshift(site);
  writeCache(cache);
  enqueue({ type: "upsert-site", row: site });
  flushQueue();
}

export function deleteSiteLocalAndQueue(id) {
  const cache = readCache();
  cache.sites = cache.sites.filter((s) => s.id !== id);
  delete cache.camerasBySite[id];
  writeCache(cache);
  enqueue({ type: "delete-site", id });
  flushQueue();
}

export function saveCameraLocalAndQueue(siteId, camera) {
  const cache = readCache();
  const list = cache.camerasBySite[siteId] || [];
  const idx = list.findIndex((c) => c.id === camera.id);
  if (idx >= 0) list[idx] = camera;
  else list.push(camera);
  cache.camerasBySite[siteId] = list;
  writeCache(cache);
  enqueue({ type: "upsert-camera", row: camera });
  flushQueue();
}

export function deleteCameraLocalAndQueue(siteId, cameraId) {
  const cache = readCache();
  cache.camerasBySite[siteId] = (cache.camerasBySite[siteId] || []).filter((c) => c.id !== cameraId);
  delete cache.pinsByCamera[cameraId];
  writeCache(cache);
  enqueue({ type: "delete-camera", id: cameraId });
  enqueue({ type: "delete-pin", cameraId });
  flushQueue();
}

export function savePinLocalAndQueue(pin) {
  const cache = readCache();
  cache.pinsByCamera[pin.camera_id] = pin;
  writeCache(cache);
  enqueue({ type: "upsert-pin", row: pin });
  flushQueue();
}

export function deletePinLocalAndQueue(cameraId) {
  const cache = readCache();
  delete cache.pinsByCamera[cameraId];
  writeCache(cache);
  enqueue({ type: "delete-pin", cameraId });
  flushQueue();
}

export async function uploadFloorplan(siteId, blob, ext) {
  const path = `${siteId}/floorplan-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("floorplans").upload(path, blob, {
    upsert: true,
    contentType: blob.type || "image/jpeg",
  });
  if (error) throw error;
  const { data } = supabase.storage.from("floorplans").getPublicUrl(path);
  return data.publicUrl;
}

export function pendingCount() {
  return readQueue().length;
}
